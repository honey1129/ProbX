import anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import type { ProbxPrediction } from "../target/types/probx_prediction";

const { BN, web3 } = anchor;
type Program<T extends anchor.Idl = anchor.Idl> = anchor.Program<T>;
type PublicKey = anchor.web3.PublicKey;
type AnchorBN = InstanceType<typeof BN>;

const SIDE_NO = 0;
const SIDE_YES = 1;
const OUTCOME_CANCELLED = 2;
const PRICE_SCALE = new BN(1_000_000_000);
const LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL;
const PROTOCOL_FEE_BPS = new BN(100);
const BPS_DENOMINATOR = new BN(10_000);

type Quote = {
  sharesOut: AnchorBN;
  lamportsOut: AnchorBN;
  nextYesPool: AnchorBN;
  nextNoPool: AnchorBN;
};

describe("probx_prediction", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ProbxPrediction as Program<ProbxPrediction>;
  const creator = provider.wallet.publicKey;
  const yesUser = web3.Keypair.generate();
  const noUser = web3.Keypair.generate();
  const treasury = web3.Keypair.generate();
  const [config] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId
  );

  const question = "Will SOL close above $250 this Friday?";

  async function fund(pubkey: PublicKey, lamports: number) {
    const signature = await provider.connection.requestAirdrop(pubkey, lamports);
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      { signature, ...latest },
      "confirmed"
    );
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  before(async () => {
    try {
      await program.account.protocolConfig.fetch(config);
    } catch {
      await program.methods
        .initializeProtocol(treasury.publicKey, PROTOCOL_FEE_BPS.toNumber())
        .accountsStrict({
          config,
          authority: creator,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    }
  });

  it("creates an AMM market, buys and sells shares, resolves, and redeems winners", async () => {
    await fund(yesUser.publicKey, 5 * LAMPORTS_PER_SOL);
    await fund(noUser.publicKey, 5 * LAMPORTS_PER_SOL);

    const endTime = new BN(Math.floor(Date.now() / 1000) + 5);
    const initialLiquidity = new BN(2 * LAMPORTS_PER_SOL);
    const [market] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        creator.toBuffer(),
        endTime.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [yesPosition] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), yesUser.publicKey.toBuffer()],
      program.programId
    );
    const [noPosition] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), noUser.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createMarket(question, endTime, initialLiquidity)
      .accountsStrict({
        market,
        creator,
        config,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    let marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.question, question);
    assert.ok(marketAccount.creator.equals(creator));
    assert.ok(marketAccount.resolver.equals(creator));
    assert.ok(marketAccount.treasury.equals(treasury.publicKey));
    assert.equal(marketAccount.protocolFeeBps, PROTOCOL_FEE_BPS.toNumber());
    assert.equal(marketAccount.creatorLpShares.toString(), initialLiquidity.toString());
    assert.equal(marketAccount.resolved, false);
    assert.equal(marketAccount.yesPool.toString(), initialLiquidity.toString());
    assert.equal(marketAccount.noPool.toString(), initialLiquidity.toString());
    assert.equal(
      marketAccount.totalLiquidity.toString(),
      initialLiquidity.toString()
    );

    const startingPrice = (await program.methods
      .getPrice()
      .accountsStrict({ market })
      .view()) as AnchorBN;
    assert.equal(startingPrice.toString(), PRICE_SCALE.div(new BN(2)).toString());

    const yesBuyAmount = new BN(1 * LAMPORTS_PER_SOL);
    const yesBuyFee = protocolFee(yesBuyAmount);
    const yesBuyQuote = quoteBuy(
      marketAccount.yesPool,
      marketAccount.noPool,
      yesBuyAmount.sub(yesBuyFee),
      SIDE_YES
    );
    const treasuryBeforeBuy = await provider.connection.getBalance(treasury.publicKey);

    await program.methods
      .buyShares(yesBuyAmount, SIDE_YES, yesBuyQuote.sharesOut)
      .accountsStrict({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
        treasury: treasury.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([yesUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.yesPool.toString(), yesBuyQuote.nextYesPool.toString());
    assert.equal(marketAccount.noPool.toString(), yesBuyQuote.nextNoPool.toString());
    assert.equal(marketAccount.yesShares.toString(), yesBuyQuote.sharesOut.toString());
    assert.equal(marketAccount.protocolFeesCollected.toString(), yesBuyFee.toString());
    const treasuryAfterBuy = await provider.connection.getBalance(treasury.publicKey);
    assert.equal(treasuryAfterBuy - treasuryBeforeBuy, yesBuyFee.toNumber());

    const yesPositionAccount = await program.account.position.fetch(yesPosition);
    assert.equal(yesPositionAccount.yesAmount.toString(), yesBuyQuote.sharesOut.toString());

    const noBuyAmount = new BN(500_000_000);
    const noBuyFee = protocolFee(noBuyAmount);
    const noBuyQuote = quoteBuy(
      marketAccount.yesPool,
      marketAccount.noPool,
      noBuyAmount.sub(noBuyFee),
      SIDE_NO
    );

    await program.methods
      .buyShares(noBuyAmount, SIDE_NO, noBuyQuote.sharesOut)
      .accountsStrict({
        market,
        position: noPosition,
        owner: noUser.publicKey,
        treasury: treasury.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([noUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.noShares.toString(), noBuyQuote.sharesOut.toString());

    const sellShares = yesBuyQuote.sharesOut.div(new BN(2));
    const sellQuote = quoteSell(
      marketAccount.yesPool,
      marketAccount.noPool,
      sellShares,
      SIDE_YES
    );
    const sellFee = protocolFee(sellQuote.lamportsOut);

    await program.methods
      .sellShares(sellShares, SIDE_YES, sellQuote.lamportsOut.sub(sellFee))
      .accountsStrict({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
        treasury: treasury.publicKey,
      })
      .signers([yesUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.yesPool.toString(), sellQuote.nextYesPool.toString());
    assert.equal(marketAccount.noPool.toString(), sellQuote.nextNoPool.toString());

    const remainingYesPosition = await program.account.position.fetch(yesPosition);
    assert.equal(
      remainingYesPosition.yesAmount.toString(),
      yesBuyQuote.sharesOut.sub(sellShares).toString()
    );

    await sleep(5500);

    await program.methods
      .resolveMarket(SIDE_YES)
      .accountsStrict({
        market,
        resolver: creator,
      })
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.resolved, true);
    assert.equal(marketAccount.outcome, SIDE_YES);

    const before = await provider.connection.getBalance(yesUser.publicKey);

    await program.methods
      .redeemWinnings()
      .accountsStrict({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
      })
      .signers([yesUser])
      .rpc();

    const after = await provider.connection.getBalance(yesUser.publicKey);
    assert.isAbove(after - before, remainingYesPosition.yesAmount.toNumber() - 10_000);

    const redeemedPosition = await program.account.position.fetch(yesPosition);
    assert.equal(redeemedPosition.yesAmount.toString(), "0");
    assert.equal(redeemedPosition.noAmount.toString(), "0");

    try {
      await program.methods
        .redeemWinnings()
        .accountsStrict({
          market,
          position: noPosition,
          owner: noUser.publicKey,
        })
        .signers([noUser])
        .rpc();
      assert.fail("losing side should not be redeemable");
    } catch (error) {
      assert.match(String(error), /NoWinningPosition|no claimable/i);
    }

    await program.methods
      .withdrawResidual()
      .accountsStrict({
        market,
        creator,
      })
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.residualClaimed, true);
    assert.equal(marketAccount.totalLiquidity.toString(), "0");
  });

  it("updates resolver, cancels a market, and refunds cancelled positions", async () => {
    const refundUser = web3.Keypair.generate();
    const nextResolver = web3.Keypair.generate();
    await fund(refundUser.publicKey, 5 * LAMPORTS_PER_SOL);
    await fund(nextResolver.publicKey, 1 * LAMPORTS_PER_SOL);

    const endTime = new BN(Math.floor(Date.now() / 1000) + 60);
    const initialLiquidity = new BN(2 * LAMPORTS_PER_SOL);
    const [market] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        creator.toBuffer(),
        endTime.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [position] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), refundUser.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createMarket("Will this market be voided?", endTime, initialLiquidity)
      .accountsStrict({
        market,
        creator,
        config,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .setResolver(nextResolver.publicKey)
      .accountsStrict({
        market,
        resolver: creator,
      })
      .rpc();

    let marketAccount = await program.account.market.fetch(market);
    assert.ok(marketAccount.resolver.equals(nextResolver.publicKey));

    const yesAmount = new BN(1 * LAMPORTS_PER_SOL);
    await program.methods
      .buyShares(yesAmount, SIDE_YES, new BN(0))
      .accountsStrict({
        market,
        position,
        owner: refundUser.publicKey,
        treasury: treasury.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([refundUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    const noAmount = new BN(500_000_000);
    await program.methods
      .buyShares(noAmount, SIDE_NO, new BN(0))
      .accountsStrict({
        market,
        position,
        owner: refundUser.publicKey,
        treasury: treasury.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([refundUser])
      .rpc();

    const fundedPosition = await program.account.position.fetch(position);
    const refundable = fundedPosition.yesAmount.add(fundedPosition.noAmount);
    assert.isAbove(refundable.toNumber(), 0);

    try {
      await program.methods
        .cancelMarket()
        .accountsStrict({
          market,
          resolver: creator,
        })
        .rpc();
      assert.fail("previous resolver should not cancel after handoff");
    } catch (error) {
      assert.match(String(error), /UnauthorizedResolver|constraint/i);
    }

    await program.methods
      .cancelMarket()
      .accountsStrict({
        market,
        resolver: nextResolver.publicKey,
      })
      .signers([nextResolver])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.resolved, true);
    assert.equal(marketAccount.outcome, OUTCOME_CANCELLED);

    const before = await provider.connection.getBalance(refundUser.publicKey);
    await program.methods
      .refundCancelled()
      .accountsStrict({
        market,
        position,
        owner: refundUser.publicKey,
      })
      .signers([refundUser])
      .rpc();
    const after = await provider.connection.getBalance(refundUser.publicKey);
    assert.isAbove(after - before, refundable.toNumber() - 10_000);

    const refundedPosition = await program.account.position.fetch(position);
    assert.equal(refundedPosition.yesAmount.toString(), "0");
    assert.equal(refundedPosition.noAmount.toString(), "0");
  });
});

function quoteBuy(yesPool: AnchorBN, noPool: AnchorBN, amount: AnchorBN, side: number): Quote {
  const yes = BigInt(yesPool.toString());
  const no = BigInt(noPool.toString());
  const input = BigInt(amount.toString());
  const invariant = yes * no;

  if (side === SIDE_YES) {
    const nextYes = yes + input;
    const nextNo = ceilDiv(invariant, nextYes);
    return {
      sharesOut: fromBigInt(no - nextNo),
      lamportsOut: new BN(0),
      nextYesPool: fromBigInt(nextYes),
      nextNoPool: fromBigInt(nextNo),
    };
  }

  const nextNo = no + input;
  const nextYes = ceilDiv(invariant, nextNo);
  return {
    sharesOut: fromBigInt(yes - nextYes),
    lamportsOut: new BN(0),
    nextYesPool: fromBigInt(nextYes),
    nextNoPool: fromBigInt(nextNo),
  };
}

function quoteSell(yesPool: AnchorBN, noPool: AnchorBN, shares: AnchorBN, side: number): Quote {
  const yes = BigInt(yesPool.toString());
  const no = BigInt(noPool.toString());
  const input = BigInt(shares.toString());
  const invariant = yes * no;

  if (side === SIDE_YES) {
    const nextNo = no + input;
    const nextYes = ceilDiv(invariant, nextNo);
    return {
      sharesOut: new BN(0),
      lamportsOut: fromBigInt(yes - nextYes),
      nextYesPool: fromBigInt(nextYes),
      nextNoPool: fromBigInt(nextNo),
    };
  }

  const nextYes = yes + input;
  const nextNo = ceilDiv(invariant, nextYes);
  return {
    sharesOut: new BN(0),
    lamportsOut: fromBigInt(no - nextNo),
    nextYesPool: fromBigInt(nextYes),
    nextNoPool: fromBigInt(nextNo),
  };
}

function protocolFee(amount: AnchorBN) {
  return amount.mul(PROTOCOL_FEE_BPS).div(BPS_DENOMINATOR);
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

function fromBigInt(value: bigint) {
  return new BN(value.toString());
}
