import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { assert } from "chai";
import type { ProbxPrediction } from "../target/types/probx_prediction";

const SIDE_NO = 0;
const SIDE_YES = 1;
const OUTCOME_CANCELLED = 2;
const PRICE_SCALE = new BN(1_000_000_000);
const LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL;

type Quote = {
  sharesOut: BN;
  lamportsOut: BN;
  nextYesPool: BN;
  nextNoPool: BN;
};

describe("probx_prediction", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ProbxPrediction as Program<ProbxPrediction>;
  const creator = provider.wallet.publicKey;
  const yesUser = web3.Keypair.generate();
  const noUser = web3.Keypair.generate();

  const question = "Will SOL close above $250 this Friday?";

  async function fund(pubkey: web3.PublicKey, lamports: number) {
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
      .accounts({
        market,
        creator,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    let marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.question, question);
    assert.ok(marketAccount.creator.equals(creator));
    assert.ok(marketAccount.resolver.equals(creator));
    assert.equal(marketAccount.resolved, false);
    assert.equal(marketAccount.yesPool.toString(), initialLiquidity.toString());
    assert.equal(marketAccount.noPool.toString(), initialLiquidity.toString());
    assert.equal(
      marketAccount.totalLiquidity.toString(),
      initialLiquidity.toString()
    );

    const startingPrice = (await program.methods
      .getPrice()
      .accounts({ market })
      .view()) as BN;
    assert.equal(startingPrice.toString(), PRICE_SCALE.div(new BN(2)).toString());

    const yesBuyAmount = new BN(1 * LAMPORTS_PER_SOL);
    const yesBuyQuote = quoteBuy(
      marketAccount.yesPool,
      marketAccount.noPool,
      yesBuyAmount,
      SIDE_YES
    );

    await program.methods
      .buyShares(yesBuyAmount, SIDE_YES, yesBuyQuote.sharesOut)
      .accounts({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([yesUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.yesPool.toString(), yesBuyQuote.nextYesPool.toString());
    assert.equal(marketAccount.noPool.toString(), yesBuyQuote.nextNoPool.toString());
    assert.equal(marketAccount.yesShares.toString(), yesBuyQuote.sharesOut.toString());

    const yesPositionAccount = await program.account.position.fetch(yesPosition);
    assert.equal(yesPositionAccount.yesAmount.toString(), yesBuyQuote.sharesOut.toString());

    const noBuyAmount = new BN(500_000_000);
    const noBuyQuote = quoteBuy(
      marketAccount.yesPool,
      marketAccount.noPool,
      noBuyAmount,
      SIDE_NO
    );

    await program.methods
      .buyShares(noBuyAmount, SIDE_NO, noBuyQuote.sharesOut)
      .accounts({
        market,
        position: noPosition,
        owner: noUser.publicKey,
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

    await program.methods
      .sellShares(sellShares, SIDE_YES, sellQuote.lamportsOut)
      .accounts({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
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
      .accounts({
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
      .accounts({
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
        .accounts({
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
      .accounts({
        market,
        creator,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .setResolver(nextResolver.publicKey)
      .accounts({
        market,
        resolver: creator,
      })
      .rpc();

    let marketAccount = await program.account.market.fetch(market);
    assert.ok(marketAccount.resolver.equals(nextResolver.publicKey));

    const yesAmount = new BN(1 * LAMPORTS_PER_SOL);
    await program.methods
      .buyShares(yesAmount, SIDE_YES, new BN(0))
      .accounts({
        market,
        position,
        owner: refundUser.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([refundUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    const noAmount = new BN(500_000_000);
    await program.methods
      .buyShares(noAmount, SIDE_NO, new BN(0))
      .accounts({
        market,
        position,
        owner: refundUser.publicKey,
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
        .accounts({
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
      .accounts({
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
      .accounts({
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

function quoteBuy(yesPool: BN, noPool: BN, amount: BN, side: number): Quote {
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

function quoteSell(yesPool: BN, noPool: BN, shares: BN, side: number): Quote {
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

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

function fromBigInt(value: bigint) {
  return new BN(value.toString());
}
