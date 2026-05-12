import * as anchor from "@coral-xyz/anchor";
import type { ProbxPrediction } from "../target/types/probx_prediction";

const { web3 } = anchor;

type Program<T extends anchor.Idl = anchor.Idl> = anchor.Program<T>;

const MAX_PROTOCOL_FEE_BPS = 1_000;

type Args = {
  command: "status" | "init" | "update" | "set";
  treasury?: string;
  feeBps?: number;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ProbxPrediction as Program<ProbxPrediction>;
  const [config] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    program.programId
  );

  if (args.command === "status") {
    await printStatus(program, config);
    return;
  }

  if (!args.treasury) {
    throw new Error("Missing --treasury <pubkey>.");
  }
  if (args.feeBps === undefined) {
    throw new Error("Missing --fee-bps <bps>.");
  }
  if (args.feeBps < 0 || args.feeBps > MAX_PROTOCOL_FEE_BPS) {
    throw new Error(`--fee-bps must be between 0 and ${MAX_PROTOCOL_FEE_BPS}.`);
  }

  const treasury = new web3.PublicKey(args.treasury);
  const existing = await fetchConfig(program, config);

  if (args.command === "init" && existing) {
    throw new Error(`Protocol config already exists at ${config.toBase58()}. Use update or set.`);
  }
  if (args.command === "update" && !existing) {
    throw new Error(`Protocol config does not exist at ${config.toBase58()}. Use init or set.`);
  }

  const shouldInit = args.command === "init" || (args.command === "set" && !existing);
  const signature = shouldInit
    ? await program.methods
        .initializeProtocol(treasury, args.feeBps)
        .accountsStrict({
          config,
          authority: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc()
    : await program.methods
        .updateProtocolConfig(treasury, args.feeBps)
        .accountsStrict({
          config,
          authority: provider.wallet.publicKey,
        })
        .rpc();

  console.log(`${shouldInit ? "Initialized" : "Updated"} protocol config`);
  console.log(`config=${config.toBase58()}`);
  console.log(`authority=${provider.wallet.publicKey.toBase58()}`);
  console.log(`treasury=${treasury.toBase58()}`);
  console.log(`protocolFeeBps=${args.feeBps}`);
  console.log(`signature=${signature}`);
}

async function printStatus(program: Program<ProbxPrediction>, config: anchor.web3.PublicKey) {
  const account = await fetchConfig(program, config);
  console.log(`config=${config.toBase58()}`);
  if (!account) {
    console.log("status=missing");
    return;
  }
  console.log("status=initialized");
  console.log(`authority=${account.authority.toBase58()}`);
  console.log(`treasury=${account.treasury.toBase58()}`);
  console.log(`protocolFeeBps=${account.protocolFeeBps}`);
}

async function fetchConfig(program: Program<ProbxPrediction>, config: anchor.web3.PublicKey) {
  try {
    return await program.account.protocolConfig.fetch(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Account does not exist") || message.includes("Could not find")) {
      return null;
    }
    throw error;
  }
}

function parseArgs(argv: string[]): Args {
  const command = (argv[0] || "status") as Args["command"];
  if (!["status", "init", "update", "set"].includes(command)) {
    throw new Error("Usage: npm run protocol:config -- <status|init|update|set> [--treasury <pubkey>] [--fee-bps <bps>]");
  }

  const args: Args = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--treasury") {
      args.treasury = value;
      index += 1;
    } else if (key === "--fee-bps") {
      const feeBps = Number(value);
      if (!Number.isInteger(feeBps)) {
        throw new Error("--fee-bps must be an integer.");
      }
      args.feeBps = feeBps;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }
  return args;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
