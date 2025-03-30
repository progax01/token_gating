const anchor = require("@project-serum/anchor");
const fs = require("fs");
const path = require("path");
const splToken = require("@solana/spl-token");
const { SystemProgram, PublicKey, Keypair } = anchor.web3;

// Use the well-known SPL Token program ID.
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

// Helper: convert a number to an 8-byte Buffer in little-endian
function bnToLE(num) {
  const bn = new anchor.BN(num);
  return bn.toArrayLike(Buffer, "le", 8);
}

// Load wallet keypair from file path passed as command-line argument or use a default path.
const WALLET_PATH = process.argv[2] || path.join(process.env.HOME, ".config", "solana", "id.json");
if (!fs.existsSync(WALLET_PATH)) {
  console.error("Wallet file not found at:", WALLET_PATH);
  process.exit(1);
}
const walletData = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"));
const walletKeyPair = Keypair.fromSecretKey(new Uint8Array(walletData));

// Set up connection and provider using the wallet keypair.
const connection = new anchor.web3.Connection("http://127.0.0.1:8899", "confirmed");
const wallet = new anchor.Wallet(walletKeyPair);
const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
anchor.setProvider(provider);

async function main() {
  console.log("Provider set to localnet:", provider.connection.rpcEndpoint);
  console.log("Using wallet:", wallet.publicKey.toBase58());

  // ------------------------------------------------------------------
  // STEP 1: Create an SPL token mint (for requiredMint) and initialize the user token account
  // ------------------------------------------------------------------
  // Create a new mint with 0 decimals; the wallet is set as the mint authority.
  const mint = await splToken.createMint(
    connection,
    walletKeyPair,
    wallet.publicKey,
    null,
    0
  );
  console.log("Mint created:", mint.toBase58());

  // Create the associated token account for the wallet (user)
  const userTokenAccountObj = await splToken.getOrCreateAssociatedTokenAccount(
    connection,
    walletKeyPair,
    mint,
    wallet.publicKey
  );
  const userTokenAccount = userTokenAccountObj.address;
  console.log("User token account initialized:", userTokenAccount.toBase58());

  // Mint some tokens (e.g. 100 tokens) to the user's token account so that it holds a balance.
  await splToken.mintTo(
    connection,
    walletKeyPair,
    mint,
    userTokenAccount,
    wallet.publicKey,
    100
  );
  console.log("Minted 100 tokens to user token account.");

  // ------------------------------------------------------------------
  // Program setup
  // ------------------------------------------------------------------
  // Program ID (from your declare_id!)
  const programId = new PublicKey("DXqZwbkwKoMx84ibFpNaYTHVvLPLJHZPchhWw1nKsyex");
  // Load the IDL (make sure idl.json is in your project directory)
  const idl = require("./target/idl/token_gating.json");

  // Initialize the program client
  const program = new anchor.Program(idl, programId, provider);

  // Use the provider wallet as the admin and for user actions
  const admin = provider.wallet;
  const user = provider.wallet;

  // For updateResource, create a dummy new mint (you may also create and initialize this if needed)
  const newMint = Keypair.generate().publicKey;

  // For contract calls, we now use our created mint as the requiredMint
  const requiredMint = mint; // requiredMint is the SPL token we just created

  // ---------- 2. Configure Resource ----------
  const resourceName = "TestResource";
  // Derive resource PDA using seed: [resourceName]
  const [resourcePDA] = await PublicKey.findProgramAddress(
    [Buffer.from(resourceName)],
    program.programId
  );
  console.log("Resource PDA:", resourcePDA.toBase58());

  console.log(">>> Configuring resource...");
  const tx1 = await program.rpc.configureResource(resourceName, requiredMint, {
    accounts: {
      admin: admin.publicKey,
      resource: resourcePDA,
      systemProgram: SystemProgram.programId,
    },
  });
  console.log("Resource configured. Tx:", tx1);

  // ---------- 3. Update Resource ----------
  console.log(">>> Updating resource with new mint...");
  const tx2 = await program.rpc.updateResource(resourceName, newMint, {
    accounts: {
      admin: admin.publicKey,
      resource: resourcePDA,
      systemProgram: SystemProgram.programId,
    },
  });
  console.log("Resource updated. Tx:", tx2);

  // ---------- 4. Verify Access ----------
  console.log(">>> Verifying user access...");
  const tx3 = await program.rpc.verifyAccess(resourceName, {
    accounts: {
      user: user.publicKey,
      resource: resourcePDA,
      userTokenAccount: userTokenAccount, // now properly initialized with tokens
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });
  console.log("Access verified. Tx:", tx3);

  // ---------- 5. Configure Levels ----------
  // Define a thresholds vector (for example, levels for token balance: 10, 50, 100)
  const thresholds = [new anchor.BN(10), new anchor.BN(50), new anchor.BN(100)];
  // Derive levels PDA using seed: [ "levels", resourcePDA ]
  const [levelsPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("levels"), resourcePDA.toBuffer()],
    program.programId
  );
  console.log("Levels PDA:", levelsPDA.toBase58());

  console.log(">>> Configuring levels...");
  const tx4 = await program.rpc.configureLevels(
    resourceName,
    thresholds.map((bn) => bn.toNumber()),
    {
      accounts: {
        admin: admin.publicKey,
        resource: resourcePDA,
        levels: levelsPDA,
        systemProgram: SystemProgram.programId,
      },
    }
  );
  console.log("Levels configured. Tx:", tx4);

  // ---------- 6. Check User Level ----------
  console.log(">>> Checking user level...");
  const tx5 = await program.rpc.checkLevel(resourceName, {
    accounts: {
      user: user.publicKey,
      resource: resourcePDA,
      levels: levelsPDA,
      userTokenAccount: userTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });
  console.log("User level checked. Tx:", tx5);

  // ---------- 7. Configure Claim Window ----------
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 10; // claim window starts 10 seconds from now
  const endTime = now + 3600; // claim window ends in 1 hour
  const requiredLevelForClaim = 2;
  const [claimWindowPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("claim"), resourcePDA.toBuffer(), bnToLE(startTime)],
    program.programId
  );
  console.log("Claim Window PDA:", claimWindowPDA.toBase58());

  console.log(">>> Configuring claim window...");
  const tx6 = await program.rpc.configureClaim(
    resourceName,
    new anchor.BN(startTime),
    new anchor.BN(endTime),
    requiredLevelForClaim,
    {
      accounts: {
        admin: admin.publicKey,
        resource: resourcePDA,
        claimWindow: claimWindowPDA,
        systemProgram: SystemProgram.programId,
      },
    }
  );
  console.log("Claim window configured. Tx:", tx6);

  // ---------- 8. Claim Token ----------
  const [userClaimPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("user_claim"), claimWindowPDA.toBuffer(), user.publicKey.toBuffer()],
    program.programId
  );
  console.log("User Claim PDA:", userClaimPDA.toBase58());

  console.log(">>> Claiming token...");
  const tx7 = await program.rpc.claimToken(resourceName, {
    accounts: {
      user: user.publicKey,
      resource: resourcePDA,
      levels: levelsPDA,
      claimWindow: claimWindowPDA,
      userClaim: userClaimPDA,
      userTokenAccount: userTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });
  console.log("Token claimed. Tx:", tx7);

  // ---------- 9. Add Admin ----------
  const [adminListPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("admin_list")],
    program.programId
  );
  console.log("Admin List PDA:", adminListPDA.toBase58());

  console.log(">>> Adding new admin...");
  const tx8 = await program.rpc.addAdmin(newAdmin, {
    accounts: {
      admin: admin.publicKey,
      adminList: adminListPDA,
      systemProgram: SystemProgram.programId,
    },
  });
  console.log("Admin added. Tx:", tx8);

  // ---------- 10. Remove Admin ----------
  console.log(">>> Removing admin...");
  const tx9 = await program.rpc.removeAdmin(newAdmin, {
    accounts: {
      admin: admin.publicKey,
      adminList: adminListPDA,
      systemProgram: SystemProgram.programId,
    },
  });
  console.log("Admin removed. Tx:", tx9);

  console.log("All transactions executed successfully.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error encountered:", err);
    process.exit(1);
  });
