import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { assert } from "chai";
import type { ProbxPrediction } from "../target/types/probx_prediction";

const SIDE_NO = 0;
const SIDE_YES = 1;
const PRICE_SCALE = new BN(1_000_000_000);
const LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL;

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

  it("creates a market, accepts bets, resolves, and pays winners", async () => {
    await fund(yesUser.publicKey, 5 * LAMPORTS_PER_SOL);
    await fund(noUser.publicKey, 5 * LAMPORTS_PER_SOL);

    const endTime = new BN(Math.floor(Date.now() / 1000) + 5);
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
      .createMarket(question, endTime)
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

    await program.methods
      .placeBet(new BN(1 * LAMPORTS_PER_SOL), SIDE_YES)
      .accounts({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([yesUser])
      .rpc();

    await program.methods
      .placeBet(new BN(3 * LAMPORTS_PER_SOL), SIDE_NO)
      .accounts({
        market,
        position: noPosition,
        owner: noUser.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([noUser])
      .rpc();

    marketAccount = await program.account.market.fetch(market);
    assert.equal(marketAccount.yesPool.toString(), String(1 * LAMPORTS_PER_SOL));
    assert.equal(marketAccount.noPool.toString(), String(3 * LAMPORTS_PER_SOL));
    assert.equal(
      marketAccount.totalLiquidity.toString(),
      String(4 * LAMPORTS_PER_SOL)
    );

    const price = (await program.methods
      .getPrice()
      .accounts({ market })
      .view()) as BN;
    assert.equal(price.toString(), PRICE_SCALE.div(new BN(4)).toString());

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
      .claimReward()
      .accounts({
        market,
        position: yesPosition,
        owner: yesUser.publicKey,
      })
      .signers([yesUser])
      .rpc();

    const after = await provider.connection.getBalance(yesUser.publicKey);
    assert.isAbove(after - before, 3.99 * LAMPORTS_PER_SOL);

    const claimedPosition = await program.account.position.fetch(yesPosition);
    assert.equal(claimedPosition.yesAmount.toString(), "0");
    assert.equal(claimedPosition.noAmount.toString(), "0");

    try {
      await program.methods
        .claimReward()
        .accounts({
          market,
          position: noPosition,
          owner: noUser.publicKey,
        })
        .signers([noUser])
        .rpc();
      assert.fail("losing side should not be claimable");
    } catch (error) {
      assert.match(String(error), /NoWinningPosition|no claimable/i);
    }
  });
});
