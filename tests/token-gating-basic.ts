import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TokenGating } from "../target/types/token_gating";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("token-gating-basic", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenGating as Program<TokenGating>;
  
  // Test wallets
  const admin = anchor.web3.Keypair.generate();
  const user = anchor.web3.Keypair.generate();

  // Test data
  const resourceName = "test-resource";
  let resourcePda: PublicKey;
  let tokenMint: PublicKey;
  let adminTokenAccount: PublicKey;
  let userTokenAccount: PublicKey;
  let levelsPda: PublicKey;

  before(async () => {
    // Airdrop SOL to wallets
    const adminAirdrop = await provider.connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    const userAirdrop = await provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
    
    // Wait for confirmations
    await provider.connection.confirmTransaction(adminAirdrop);
    await provider.connection.confirmTransaction(userAirdrop);
    
    // Create mint
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      0
    );
    
    // Create token accounts
    adminTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      admin.publicKey
    );
    
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      user.publicKey
    );
    
    // Mint tokens
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      adminTokenAccount,
      admin.publicKey,
      1000
    );
    
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      userTokenAccount,
      admin.publicKey,
      50
    );
    
    // Calculate PDAs
    resourcePda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(resourceName)],
      program.programId
    )[0];
    
    levelsPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("levels"), resourcePda.toBuffer()],
      program.programId
    )[0];
  });

  it("Configures a resource", async () => {
    await program.methods
      .configureResource(resourceName, tokenMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Verify resource data
    const resource = await program.account.resource.fetch(resourcePda);
    expect(resource.name).to.equal(resourceName);
    expect(resource.requiredMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(resource.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(resource.isActive).to.be.true;
  });

  it("Verifies access for user with tokens", async () => {
    await program.methods
      .verifyAccess(resourceName)
      .accounts({
        user: user.publicKey,
        resource: resourcePda,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
    
    // Success is implied if the transaction doesn't throw
  });

  it("Configures levels", async () => {
    const thresholds = [10, 50, 100];
    
    await program.methods
      .configureLevels(resourceName, thresholds)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Verify levels data
    const levels = await program.account.levels.fetch(levelsPda);
    expect(levels.resource.toBase58()).to.equal(resourcePda.toBase58());
    expect(levels.thresholds).to.deep.equal(thresholds);
  });

  it("Checks user level", async () => {
    await program.methods
      .checkLevel(resourceName)
      .accounts({
        user: user.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
    
    // Level check is verified via events, which we can't test directly
    // But transaction success means it worked
  });

  it("Configures and uses a claim window", async () => {
    // Get current time
    const currentTime = Math.floor(Date.now() / 1000);
    const startTime = currentTime;
    const endTime = currentTime + 86400; // 24 hours
    const requiredLevel = 2; // User has 50 tokens which meets level 2 threshold

    // Find claim window PDA
    const claimWindowPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), resourcePda.toBuffer(), new anchor.BN(startTime).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

    // Find user claim PDA
    const userClaimPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_claim"), claimWindowPda.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    )[0];

    // Configure claim window
    await program.methods
      .configureClaim(resourceName, new anchor.BN(startTime), new anchor.BN(endTime), requiredLevel)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        claimWindow: claimWindowPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Claim token
    await program.methods
      .claimToken(resourceName)
      .accounts({
        user: user.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        claimWindow: claimWindowPda,
        userClaim: userClaimPda,
        userTokenAccount: userTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify claim was recorded
    const userClaim = await program.account.userClaim.fetch(userClaimPda);
    expect(userClaim.user.toBase58()).to.equal(user.publicKey.toBase58());
    expect(userClaim.claimWindow.toBase58()).to.equal(claimWindowPda.toBase58());
    expect(userClaim.hasClaimed).to.be.true;
  });

  it("Tests admin management", async () => {
    // Find admin list PDA
    const adminListPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("admin_list")],
      program.programId
    )[0];

    // Create new admin
    const newAdmin = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(newAdmin.publicKey, LAMPORTS_PER_SOL);

    // Add the new admin
    await program.methods
      .addAdmin(newAdmin.publicKey)
      .accounts({
        admin: admin.publicKey,
        adminList: adminListPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Verify admin was added
    let adminList = await program.account.adminList.fetch(adminListPda);
    const admins = adminList.admins.map(a => a.toBase58());
    expect(admins).to.include(admin.publicKey.toBase58());
    expect(admins).to.include(newAdmin.publicKey.toBase58());

    // Remove the admin
    await program.methods
      .removeAdmin(newAdmin.publicKey)
      .accounts({
        admin: admin.publicKey,
        adminList: adminListPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Verify admin was removed
    adminList = await program.account.adminList.fetch(adminListPda);
    expect(adminList.admins.map(a => a.toBase58())).to.not.include(newAdmin.publicKey.toBase58());
  });
}); 