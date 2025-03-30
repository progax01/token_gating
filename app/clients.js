const anchor = require("@project-serum/anchor");
const {
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
  Connection
} = anchor.web3;
const fs = require("fs");
const path = require("path");
const {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount
} = require("@solana/spl-token");
const BN = require("bn.js");

// Program ID for token gating program
const PROGRAM_ID = "EHyipzMTK3FV63inZTyvqmSYqFxDdKJPKMhHay6yQ9mw";

// Setup and connection functions
async function setupConnection() {
  console.log("Setting up connection to Solana...");
  // You can change this to any valid endpoint
  // Options: 'mainnet-beta', 'devnet', 'testnet', or a custom URL
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  console.log("Connected to devnet");
  return connection;
}

async function setupWallet() {
  console.log("Setting up wallet...");
  // Use the specific wallet path
  const walletPath = path.resolve("/home/admin/.config/solana/id.json ");
  
  try {
    if (fs.existsSync(walletPath)) {
      console.log(`Loading wallet from ${walletPath}`);
      const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
      );
      return walletKeypair;
    } else {
      console.log(`Wallet file not found at ${walletPath}, creating new keypair`);
      const keypair = Keypair.generate();
      // Create directory if it doesn't exist
      const dir = path.dirname(walletPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(walletPath, JSON.stringify(Array.from(keypair.secretKey)));
      return keypair;
    }
  } catch (error) {
    console.log('Error loading wallet, creating a new one', error);
    const keypair = Keypair.generate();
    fs.writeFileSync('keypair.json', JSON.stringify(Array.from(keypair.secretKey)));
    return keypair;
  }
}

async function setupProvider(connection, walletKeypair) {
  console.log("Setting up Anchor provider...");
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  return provider;
}

async function loadProgram(provider) {
  console.log("Loading program and IDL...");
  // Load IDL file
  const idlPath = path.resolve("./target/idl/token_gating.json");
  
  if (!fs.existsSync(idlPath)) {
    console.error("IDL file not found. Please run 'anchor build' first.");
    process.exit(1);
  }
  
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programId = new PublicKey(PROGRAM_ID);
  const program = new anchor.Program(idl, programId, provider);
  console.log("Program loaded successfully");
  return program;
}

// PDA helpers for token gating program
async function findResourceAddress(resourceName, programId) {
  return PublicKey.findProgramAddress(
    [Buffer.from(resourceName)],
    programId
  );
}

async function findLevelsAddress(resourceAccount, programId) {
  return PublicKey.findProgramAddress(
    [Buffer.from('levels'), resourceAccount.toBuffer()],
    programId
  );
}

async function findClaimWindowAddress(resourceAccount, startTime, programId) {
  return PublicKey.findProgramAddress(
    [
      Buffer.from('claim'),
      resourceAccount.toBuffer(),
      new BN(startTime).toArrayLike(Buffer, 'le', 8)
    ],
    programId
  );
}

async function findUserClaimAddress(claimWindowAccount, userPublicKey, programId) {
  return PublicKey.findProgramAddress(
    [
      Buffer.from('user_claim'),
      claimWindowAccount.toBuffer(),
      userPublicKey.toBuffer()
    ],
    programId
  );
}

async function findAdminListAddress(programId) {
  return PublicKey.findProgramAddress(
    [Buffer.from('admin_list')],
    programId
  );
}

// Main program functions
async function configureResource(program, keypair, resourceName, tokenMint) {
  console.log(`\n=== Configuring resource: ${resourceName} ===`);
  
  const [resourceAccount] = await findResourceAddress(
    resourceName,
    program.programId
  );
  
  try {
    const tx = await program.rpc.configureResource(
      resourceName,
      tokenMint,
      {
        accounts: {
          admin: keypair.publicKey,
          resource: resourceAccount,
          systemProgram: SystemProgram.programId
        },
        signers: [keypair]
      }
    );
    
    console.log(`Resource configured with tx: ${tx}`);
    return { success: true, tx, resourceAccount };
  } catch (error) {
    console.error("Error configuring resource:", error);
    return { success: false, error };
  }
}

async function configureLevels(program, keypair, resourceName, resourceAccount, thresholds) {
  console.log(`\n=== Configuring levels for ${resourceName} ===`);
  
  const [levelsAccount] = await findLevelsAddress(
    resourceAccount,
    program.programId
  );
  
  try {
    const tx = await program.rpc.configureLevels(
      resourceName,
      thresholds.map(t => new BN(t)),
      {
        accounts: {
          admin: keypair.publicKey,
          resource: resourceAccount,
          levels: levelsAccount,
          systemProgram: SystemProgram.programId
        },
        signers: [keypair]
      }
    );
    
    console.log(`Levels configured with tx: ${tx}`);
    return { success: true, tx, levelsAccount };
  } catch (error) {
    console.error("Error configuring levels:", error);
    return { success: false, error };
  }
}

async function checkLevel(program, keypair, resourceName, resourceAccount, levelsAccount, userTokenAccount) {
  console.log(`\n=== Checking user level for ${resourceName} ===`);
  
  try {
    const tx = await program.rpc.checkLevel(
      resourceName,
      {
        accounts: {
          user: keypair.publicKey,
          resource: resourceAccount,
          levels: levelsAccount,
          userTokenAccount: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID
        },
        signers: [keypair]
      }
    );
    
    console.log(`Level checked with tx: ${tx}`);
    return { success: true, tx };
  } catch (error) {
    console.error("Error checking level:", error);
    return { success: false, error };
  }
}

async function configureClaim(program, keypair, resourceName, resourceAccount, startTime, endTime, requiredLevel) {
  console.log(`\n=== Configuring claim window for ${resourceName} ===`);
  
  const [claimWindowAccount] = await findClaimWindowAddress(
    resourceAccount,
    startTime,
    program.programId
  );
  
  try {
    const tx = await program.rpc.configureClaim(
      resourceName,
      new BN(startTime),
      new BN(endTime),
      requiredLevel,
      {
        accounts: {
          admin: keypair.publicKey,
          resource: resourceAccount,
          claimWindow: claimWindowAccount,
          systemProgram: SystemProgram.programId
        },
        signers: [keypair]
      }
    );
    
    console.log(`Claim window configured with tx: ${tx}`);
    return { success: true, tx, claimWindowAccount };
  } catch (error) {
    console.error("Error configuring claim window:", error);
    return { success: false, error };
  }
}

async function claimToken(program, keypair, resourceName, resourceAccount, levelsAccount, claimWindowAccount, userTokenAccount) {
  console.log(`\n=== Claiming token for ${resourceName} ===`);
  
  const [userClaimAccount] = await findUserClaimAddress(
    claimWindowAccount,
    keypair.publicKey,
    program.programId
  );
  
  try {
    const tx = await program.rpc.claimToken(
      resourceName,
      {
        accounts: {
          user: keypair.publicKey,
          resource: resourceAccount,
          levels: levelsAccount,
          claimWindow: claimWindowAccount,
          userClaim: userClaimAccount,
          userTokenAccount: userTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID
        },
        signers: [keypair]
      }
    );
    
    console.log(`Token claimed with tx: ${tx}`);
    return { success: true, tx };
  } catch (error) {
    console.error("Error claiming token:", error);
    return { success: false, error };
  }
}

async function verifyAccess(program, keypair, resourceName, resourceAccount, userTokenAccount) {
  console.log(`\n=== Verifying access to ${resourceName} ===`);
  
  try {
    const tx = await program.rpc.verifyAccess(
      resourceName,
      {
        accounts: {
          user: keypair.publicKey,
          resource: resourceAccount,
          userTokenAccount: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID
        },
        signers: [keypair]
      }
    );
    
    console.log(`Access verified with tx: ${tx}`);
    return { success: true, tx };
  } catch (error) {
    console.error("Error verifying access:", error);
    return { success: false, error };
  }
}

async function addAdmin(program, keypair, newAdminPubkey) {
  console.log(`\n=== Adding admin: ${newAdminPubkey.toString()} ===`);
  
  const [adminListAccount] = await findAdminListAddress(program.programId);
  
  try {
    const tx = await program.rpc.addAdmin(
      newAdminPubkey,
      {
        accounts: {
          admin: keypair.publicKey,
          adminList: adminListAccount,
          systemProgram: SystemProgram.programId
        },
        signers: [keypair]
      }
    );
    
    console.log(`Admin added with tx: ${tx}`);
    return { success: true, tx };
  } catch (error) {
    console.error("Error adding admin:", error);
    return { success: false, error };
  }
}

async function removeAdmin(program, keypair, adminToRemove) {
  console.log(`\n=== Removing admin: ${adminToRemove.toString()} ===`);
  
  const [adminListAccount] = await findAdminListAddress(program.programId);
  
  try {
    const tx = await program.rpc.removeAdmin(
      adminToRemove,
      {
        accounts: {
          admin: keypair.publicKey,
          adminList: adminListAccount,
          systemProgram: SystemProgram.programId
        },
        signers: [keypair]
      }
    );
    
    console.log(`Admin removed with tx: ${tx}`);
    return { success: true, tx };
  } catch (error) {
    console.error("Error removing admin:", error);
    return { success: false, error };
  }
}

// Main function to demo token gating functionality
async function main() {
  try {
    // Setup connection, wallet, and program
    const connection = await setupConnection();
    const keypair = await setupWallet();
    const provider = await setupProvider(connection, keypair);
    const program = await loadProgram(provider);
    
    // Check wallet balance
    const balance = await connection.getBalance(keypair.publicKey);
    console.log(`Wallet public key: ${keypair.publicKey.toString()}`);
    console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    // // Request airdrop if balance is low
    // if (balance < LAMPORTS_PER_SOL) {
    //   console.log('Requesting airdrop...');
    //   const signature = await connection.requestAirdrop(
    //     keypair.publicKey,
    //     5* LAMPORTS_PER_SOL
    //   );
    //   await connection.confirmTransaction(signature);
    //   console.log(`Airdropped 1 SOL to ${keypair.publicKey.toString()}`);
    // }
    
    // Create a new token mint
    console.log('\n=== Creating token mint ===');
    const tokenMint = await createMint(
      connection,
      keypair,
      keypair.publicKey,
      null,
      9 // decimals
    );
    console.log(`Token mint created: ${tokenMint.toString()}`);
    
    // Create token account
    console.log('\n=== Creating token account ===');
    const tokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      tokenMint,
      keypair.publicKey
    );
    const tokenAccount = tokenAccountInfo.address;
    console.log(`Token account: ${tokenAccount.toString()}`);
    
    // Mint tokens
    console.log('\n=== Minting tokens ===');
    const mintAmount = 1000 * 10**9; // 1000 tokens with 9 decimals
    await mintTo(
      connection,
      keypair,
      tokenMint,
      tokenAccount,
      keypair,
      mintAmount
    );
    
    // Verify token balance
    const account = await getAccount(connection, tokenAccount);
    console.log(`Token balance: ${Number(account.amount) / 10**9} tokens`);
    
    // Configure a resource
    const resourceName = "Gold Content";
    const { success: resourceSuccess, resourceAccount } = await configureResource(
      program,
      keypair,
      resourceName,
      tokenMint
    );
    
    if (!resourceSuccess) {
      console.error("Failed to configure resource, exiting demo");
      return;
    }
    
    // Configure levels
    const thresholds = [10, 100, 500]; // Level 1, 2, 3 thresholds
    const { success: levelsSuccess, levelsAccount } = await configureLevels(
      program,
      keypair,
      resourceName,
      resourceAccount,
      thresholds
    );
    
    if (!levelsSuccess) {
      console.error("Failed to configure levels, exiting demo");
      return;
    }
    
    // Check user level
    await checkLevel(
      program,
      keypair,
      resourceName,
      resourceAccount,
      levelsAccount,
      tokenAccount
    );
    
    // Set up claim window
    const now = Math.floor(Date.now() / 1000);
    const startTime = now;
    const endTime = now + 86400; // 24 hours
    const requiredLevel = 2; // Level 2+ can claim
    
    const { success: claimSuccess, claimWindowAccount } = await configureClaim(
      program,
      keypair,
      resourceName,
      resourceAccount,
      startTime,
      endTime,
      requiredLevel
    );
    
    if (!claimSuccess) {
      console.error("Failed to configure claim window, exiting demo");
      return;
    }
    
    // Claim tokens
    await claimToken(
      program,
      keypair,
      resourceName,
      resourceAccount,
      levelsAccount,
      claimWindowAccount,
      tokenAccount
    );
    
    // Verify access
    await verifyAccess(
      program,
      keypair,
      resourceName,
      resourceAccount,
      tokenAccount
    );
    
    // Add an admin
    const newAdmin = Keypair.generate();
    console.log(`Generated new admin: ${newAdmin.publicKey.toString()}`);
    
    await addAdmin(
      program,
      keypair,
      newAdmin.publicKey
    );
    
    // Remove the admin
    await removeAdmin(
      program,
      keypair,
      newAdmin.publicKey
    );
    
    console.log('\n=== All operations completed successfully! ===');
    
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

// Run the main function
main().catch(console.error); 