import * as anchor from "@coral-xyz/anchor";
import type { ProbxPrediction } from "../target/types/probx_prediction";

const { BN, web3 } = anchor;

type Program<T extends anchor.Idl = anchor.Idl> = anchor.Program<T>;

type Args = {
  question: string;
  endTime: number;
  initialLiquiditySol: number;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ProbxPrediction as Program<ProbxPrediction>;
  const creator = provider.wallet.publicKey;
  const [market] = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      creator.toBuffer(),
      new BN(args.endTime).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  const [config] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId
  );
  const initialLiquidity = new BN(Math.round(args.initialLiquiditySol * web3.LAMPORTS_PER_SOL));

  const signature = await program.methods
    .createMarket(args.question, new BN(args.endTime), initialLiquidity)
    .accountsStrict({
      market,
      creator,
      config,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Created market");
  console.log(`program=${program.programId.toBase58()}`);
  console.log(`market=${market.toBase58()}`);
  console.log(`creator=${creator.toBase58()}`);
  console.log(`config=${config.toBase58()}`);
  console.log(`question=${args.question}`);
  console.log(`endTime=${args.endTime}`);
  console.log(`initialLiquiditySol=${args.initialLiquiditySol}`);
  console.log(`signature=${signature}`);
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--question") {
      args.question = value;
      index += 1;
    } else if (key === "--end-time") {
      args.endTime = Number(value);
      index += 1;
    } else if (key === "--initial-liquidity") {
      args.initialLiquiditySol = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.question?.trim()) {
    throw new Error("Missing --question <text>.");
  }
  const endTime = args.endTime;
  if (endTime === undefined) {
    throw new Error("Missing --end-time <unix timestamp>.");
  }
  if (!Number.isInteger(endTime) || endTime <= Math.floor(Date.now() / 1000)) {
    throw new Error("--end-time must be a future unix timestamp.");
  }
  const initialLiquiditySol = args.initialLiquiditySol;
  if (initialLiquiditySol === undefined) {
    throw new Error("Missing --initial-liquidity <sol>.");
  }
  if (!Number.isFinite(initialLiquiditySol) || initialLiquiditySol <= 0) {
    throw new Error("Missing --initial-liquidity <sol>.");
  }

  return {
    question: args.question.trim(),
    endTime,
    initialLiquiditySol,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
