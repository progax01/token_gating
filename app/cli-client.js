const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, createMint, mintTo, getAccount } = require('@solana/spl-token');
const BN = require('bn.js');
const fs = require('fs');
const path = require('path');

// Program ID from our Solana program
const PROGRAM_ID = 'DXqZwbkwKoMx84ibFpNaYTHVvLPLJHZPchhWw1nKsyex';

async function main() {
  try {
    // Connect to Solana devnet
    console.log("Connecting to Solana localnet...");
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "processed"
    );
    
    // Load keypair from the specific path provided
    console.log("Loading wallet...");
    let keypair;
    const walletPath = path.resolve("/home/admin/.config/solana/id.json n");
    
    if (fs.existsSync(walletPath)) {
      console.log(`Loading keypair from ${walletPath}`);
      const keypairData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
      keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    } else {
      console.log(`Wallet file not found at ${walletPath}, creating new keypair`);
      keypair = Keypair.generate();
      // Create directory if it doesn't exist
      const dir = path.dirname(walletPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(walletPath, JSON.stringify(Array.from(keypair.secretKey)));
    }
    
    const wallet = new anchor.Wallet(keypair);
    console.log(`Using wallet: ${wallet.publicKey.toString()}`);
    
    // Ensure the wallet has SOL for transactions
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    if (balance < LAMPORTS_PER_SOL) {
      console.log('Requesting airdrop...');
      const signature = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature);
      console.log(`Airdropped 1 SOL to ${wallet.publicKey.toString()}`);
    }

    // Load the IDL
    console.log("Loading program IDL...");
    const idlPath = path.resolve(__dirname, '../target/idl/token_gating.json');
    if (!fs.existsSync(idlPath)) {
      console.error('IDL file not found. Please run "anchor build" first.');
      return;
    }
    const programId = new PublicKey(PROGRAM_ID);
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    
    // const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    
    // Create the program interface
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      anchor.AnchorProvider.defaultOptions()
    );
    
    anchor.setProvider(provider);
    console.log(idl,"idl loaded");
    console.log(programId,"programId loaded");
    const program = new anchor.Program(idl, programId);
    // console.log(program,"programm set done");
    // Initialize program
    // In JavaScript, we can just pass two arguments
    // const program = new anchor.Program(idl, programId);
    
    // Demo the program
    // Create token mint
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
    console.log('\n=== Configuring resource ===');
    const resourceName = "Premium Content";
    
    // Find resource PDA
    const [resourceAccount] = await PublicKey.findProgramAddress(
      [Buffer.from(resourceName)],
      programId
    );
    
    const tx1 = await program.methods
      .configureResource(resourceName, tokenMint)
      .accounts({
        admin: keypair.publicKey,
        resource: resourceAccount,
        systemProgram: SystemProgram.programId
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Resource configured with tx: ${tx1}`);
    
    // Configure levels
    console.log('\n=== Configuring levels ===');
    const thresholds = [10, 100, 500]; // Level 1, 2, 3 thresholds
    
    // Find levels PDA
    const [levelsAccount] = await PublicKey.findProgramAddress(
      [Buffer.from('levels'), resourceAccount.toBuffer()],
      programId
    );
    
    const tx2 = await program.methods
      .configureLevels(resourceName, thresholds.map(t => new BN(t)))
      .accounts({
        admin: keypair.publicKey,
        resource: resourceAccount,
        levels: levelsAccount,
        systemProgram: SystemProgram.programId
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Levels configured with tx: ${tx2}`);
    
    // Check user level
    console.log('\n=== Checking user level ===');
    const tx3 = await program.methods
      .checkLevel(resourceName)
      .accounts({
        user: keypair.publicKey,
        resource: resourceAccount,
        levels: levelsAccount,
        userTokenAccount: tokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Level checked with tx: ${tx3}`);
    console.log(`User level should be 3 (highest) with ${mintAmount / 10**9} tokens`);
    
    // Set up claim window
    console.log('\n=== Configuring claim window ===');
    const now = Math.floor(Date.now() / 1000);
    const startTime = now;
    const endTime = now + 86400; // 24 hours
    const requiredLevel = 2; // Level 2+ can claim
    
    // Find claim window PDA
    const [claimWindowAccount] = await PublicKey.findProgramAddress(
      [
        Buffer.from('claim'),
        resourceAccount.toBuffer(),
        new BN(startTime).toArrayLike(Buffer, 'le', 8)
      ],
      programId
    );
    
    const tx4 = await program.methods
      .configureClaim(resourceName, new BN(startTime), new BN(endTime), requiredLevel)
      .accounts({
        admin: keypair.publicKey,
        resource: resourceAccount,
        claimWindow: claimWindowAccount,
        systemProgram: SystemProgram.programId
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Claim window configured with tx: ${tx4}`);
    
    // Claim tokens
    console.log('\n=== Claiming tokens ===');
    
    // Find user claim PDA
    const [userClaimAccount] = await PublicKey.findProgramAddress(
      [
        Buffer.from('user_claim'),
        claimWindowAccount.toBuffer(),
        keypair.publicKey.toBuffer()
      ],
      programId
    );
    
    const tx5 = await program.methods
      .claimToken(resourceName)
      .accounts({
        user: keypair.publicKey,
        resource: resourceAccount,
        levels: levelsAccount,
        claimWindow: claimWindowAccount,
        userClaim: userClaimAccount,
        userTokenAccount: tokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Tokens claimed with tx: ${tx5}`);
    
    // Verify access
    console.log('\n=== Verifying access ===');
    const tx6 = await program.methods
      .verifyAccess(resourceName)
      .accounts({
        user: keypair.publicKey,
        resource: resourceAccount,
        userTokenAccount: tokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Access verified with tx: ${tx6}`);
    
    // Set up admin
    console.log('\n=== Adding admin ===');
    const newAdmin = Keypair.generate();
    console.log(`New admin: ${newAdmin.publicKey.toString()}`);
    
    // Find admin list PDA
    const [adminListAccount] = await PublicKey.findProgramAddress(
      [Buffer.from('admin_list')],
      programId
    );
    
    const tx7 = await program.methods
      .addAdmin(newAdmin.publicKey)
      .accounts({
        admin: keypair.publicKey,
        adminList: adminListAccount,
        systemProgram: SystemProgram.programId
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Admin added with tx: ${tx7}`);
    
    // Remove admin
    console.log('\n=== Removing admin ===');
    const tx8 = await program.methods
      .removeAdmin(newAdmin.publicKey)
      .accounts({
        admin: keypair.publicKey,
        adminList: adminListAccount,
        systemProgram: SystemProgram.programId
      })
      .signers([keypair])
      .rpc();
    
    console.log(`Admin removed with tx: ${tx8}`);
    
    console.log('\n=== All operations completed successfully! ===');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the main function
main().catch(console.error); 