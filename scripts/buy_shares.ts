import * as anchor from "@coral-xyz/anchor";
import type { ProbxPrediction } from "../target/types/probx_prediction";

const { BN, web3 } = anchor;

type Program<T extends anchor.Idl = anchor.Idl> = anchor.Program<T>;

type Args = {
  market: string;
  side: number;
  amountSol: number;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ProbxPrediction as Program<ProbxPrediction>;
  const market = new web3.PublicKey(args.market);
  const owner = provider.wallet.publicKey;
  const [position] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    program.programId
  );
  const marketAccount = await program.account.market.fetch(market);
  const treasury = marketAccount.treasury;
  const amount = new BN(Math.round(args.amountSol * web3.LAMPORTS_PER_SOL));

  const signature = await program.methods
    .buyShares(amount, args.side, new BN(0))
    .accountsStrict({
      market,
      position,
      owner,
      treasury,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Bought shares");
  console.log(`program=${program.programId.toBase58()}`);
  console.log(`market=${market.toBase58()}`);
  console.log(`position=${position.toBase58()}`);
  console.log(`owner=${owner.toBase58()}`);
  console.log(`treasury=${treasury.toBase58()}`);
  console.log(`side=${args.side === 1 ? "YES" : "NO"}`);
  console.log(`amountSol=${args.amountSol}`);
  console.log(`signature=${signature}`);
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--market") {
      args.market = value;
      index += 1;
    } else if (key === "--side") {
      const normalized = value?.toUpperCase();
      if (normalized === "YES") args.side = 1;
      else if (normalized === "NO") args.side = 0;
      else args.side = Number(value);
      index += 1;
    } else if (key === "--amount") {
      args.amountSol = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.market?.trim()) {
    throw new Error("Missing --market <pubkey>.");
  }
  const side = args.side;
  if (side !== 0 && side !== 1) {
    throw new Error("--side must be YES or NO.");
  }
  const amountSol = args.amountSol;
  if (amountSol === undefined || !Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error("Missing --amount <sol>.");
  }

  return {
    market: args.market.trim(),
    side,
    amountSol,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
