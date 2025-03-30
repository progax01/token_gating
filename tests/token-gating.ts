import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TokenGating } from "../target/types/token_gating";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("token-gating", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenGating as Program<TokenGating>;
  
  // Test wallets
  const admin = anchor.web3.Keypair.generate();
  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();
  const newAdmin = anchor.web3.Keypair.generate();

  // Test data
  const resourceName = "premium-content";
  const resourcePda = PublicKey.findProgramAddressSync(
    [Buffer.from(resourceName)],
    program.programId
  )[0];
  
  // Token data
  let tokenMint: PublicKey;
  let adminTokenAccount: PublicKey;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  
  // Level data
  const thresholds = [10, 50, 100]; // Level 1, 2, and 3 thresholds
  let levelsPda: PublicKey;
  
  // Claim window data
  let claimWindowPda: PublicKey;
  let user1ClaimPda: PublicKey;
  let user2ClaimPda: PublicKey;
  
  // Admin list data
  let adminListPda: PublicKey;

  it("Airdrop SOL to wallets", async () => {
    // Airdrop SOL for transaction fees
    await provider.connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user1.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user2.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(newAdmin.publicKey, 10 * LAMPORTS_PER_SOL);
    
    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  it("Create token mint and accounts", async () => {
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
    
    user1TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      user1.publicKey
    );
    
    user2TokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      user2.publicKey
    );
    
    // Mint tokens to admin (admin gets 1000 tokens)
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      adminTokenAccount,
      admin.publicKey,
      1000
    );
    
    // Mint tokens to user1 (user1 gets 75 tokens - Level 2)
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      user1TokenAccount,
      admin.publicKey,
      75
    );
    
    // Mint tokens to user2 (user2 gets 5 tokens - below Level 1)
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      user2TokenAccount,
      admin.publicKey,
      5
    );
  });

  // Test 1A: Configure Resource
  it("Configure resource", async () => {
    await program.methods
      .configureResource(resourceName, tokenMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Fetch and verify the resource data
    const resource = await program.account.resource.fetch(resourcePda);
    expect(resource.name).to.equal(resourceName);
    expect(resource.requiredMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(resource.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(resource.isActive).to.be.true;
  });

  // Test 1A: Update Resource
  it("Update resource mint", async () => {
    // Create a new mint to update to
    const newMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      0
    );
    
    await program.methods
      .updateResource(resourceName, newMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Fetch and verify the updated resource data
    const resource = await program.account.resource.fetch(resourcePda);
    expect(resource.requiredMint.toBase58()).to.equal(newMint.toBase58());
    
    // Revert back to original mint for subsequent tests
    await program.methods
      .updateResource(resourceName, tokenMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  });

  // Test 1B: Verify Access (success case)
  it("Verify access - success", async () => {
    await program.methods
      .verifyAccess(resourceName)
      .accounts({
        user: user1.publicKey,
        resource: resourcePda,
        userTokenAccount: user1TokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();
    
    // No assertion needed - if the transaction completes without error, access is verified
  });

  // Test 1B: Verify Access (failure case - insufficient tokens)
  it("Verify access - failure (zero tokens)", async () => {
    // Create a new user with no tokens
    const userNoTokens = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(userNoTokens.publicKey, 2 * LAMPORTS_PER_SOL);
    
    // Create token account but don't mint any tokens
    const noTokensAccount = await createAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      userNoTokens.publicKey
    );
    
    try {
      await program.methods
        .verifyAccess(resourceName)
        .accounts({
          user: userNoTokens.publicKey,
          resource: resourcePda,
          userTokenAccount: noTokensAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userNoTokens])
        .rpc();
      
      // If we reach here, the test failed because the transaction should have errored
      expect.fail("Expected transaction to fail");
    } catch (error) {
      // Verify it fails with the expected error
      expect(error.toString()).to.include("InsufficientTokenBalance");
    }
  });

  // Test 2A: Configure Levels
  it("Configure levels", async () => {
    // Find levels PDA
    levelsPda = PublicKey.findProgramAddressSync(
      [Buffer.from("levels"), resourcePda.toBuffer()],
      program.programId
    )[0];
    
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
    
    // Fetch and verify the levels data
    const levels = await program.account.levels.fetch(levelsPda);
    expect(levels.thresholds).to.deep.equal(thresholds);
    expect(levels.resource.toBase58()).to.equal(resourcePda.toBase58());
  });

  // Test 2A: Check User Level
  it("Check user level", async () => {
    // Test user1's level (should be level 2)
    await program.methods
      .checkLevel(resourceName)
      .accounts({
        user: user1.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        userTokenAccount: user1TokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();
    
    // Test user2's level (should be level 0)
    await program.methods
      .checkLevel(resourceName)
      .accounts({
        user: user2.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        userTokenAccount: user2TokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();
    
    // No direct assertions here, but we can check the emitted events in a real environment
  });

  // Test 2B: Configure Claim Window
  it("Configure claim window", async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    const startTime = currentTime;
    const endTime = currentTime + 86400; // 24 hours from now
    const requiredLevel = 2;
    
    // Find claim window PDA
    claimWindowPda = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), resourcePda.toBuffer(), new anchor.BN(startTime).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
    
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
    
    // Fetch and verify claim window data
    const claimWindow = await program.account.claimWindow.fetch(claimWindowPda);
    expect(claimWindow.resource.toBase58()).to.equal(resourcePda.toBase58());
    expect(claimWindow.startTime.toString()).to.equal(startTime.toString());
    expect(claimWindow.endTime.toString()).to.equal(endTime.toString());
    expect(claimWindow.requiredLevel).to.equal(requiredLevel);
    expect(claimWindow.isActive).to.be.true;
    
    // Set up user claim PDAs
    user1ClaimPda = PublicKey.findProgramAddressSync(
      [Buffer.from("user_claim"), claimWindowPda.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    )[0];
    
    user2ClaimPda = PublicKey.findProgramAddressSync(
      [Buffer.from("user_claim"), claimWindowPda.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    )[0];
  });

  // Test 2B: Claim Token (success)
  it("Claim token - success", async () => {
    await program.methods
      .claimToken(resourceName)
      .accounts({
        user: user1.publicKey,
        resource: resourcePda,
        levels: levelsPda,
        claimWindow: claimWindowPda,
        userClaim: user1ClaimPda,
        userTokenAccount: user1TokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();
    
    // Verify user claim data
    const userClaim = await program.account.userClaim.fetch(user1ClaimPda);
    expect(userClaim.user.toBase58()).to.equal(user1.publicKey.toBase58());
    expect(userClaim.claimWindow.toBase58()).to.equal(claimWindowPda.toBase58());
    expect(userClaim.hasClaimed).to.be.true;
  });

  // Test 2B: Claim Token (failure - already claimed)
  it("Claim token - failure (already claimed)", async () => {
    try {
      await program.methods
        .claimToken(resourceName)
        .accounts({
          user: user1.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          claimWindow: claimWindowPda,
          userClaim: user1ClaimPda,
          userTokenAccount: user1TokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
      
      // If we reach here, the test failed
      expect.fail("Expected transaction to fail");
    } catch (error) {
      // Verify it fails with the expected error
      expect(error.toString()).to.include("AlreadyClaimed");
    }
  });

  // Test 2B: Claim Token (failure - insufficient level)
  it("Claim token - failure (insufficient level)", async () => {
    try {
      await program.methods
        .claimToken(resourceName)
        .accounts({
          user: user2.publicKey,
          resource: resourcePda,
          levels: levelsPda,
          claimWindow: claimWindowPda,
          userClaim: user2ClaimPda,
          userTokenAccount: user2TokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();
      
      // If we reach here, the test failed
      expect.fail("Expected transaction to fail");
    } catch (error) {
      // Verify it fails with the expected error
      expect(error.toString()).to.include("InsufficientLevel");
    }
  });

  // Test Admin Management
  it("Add and remove admin", async () => {
    // Find admin list PDA
    adminListPda = PublicKey.findProgramAddressSync(
      [Buffer.from("admin_list")],
      program.programId
    )[0];
    
    // Add a new admin
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
    expect(adminList.admins).to.include.deep.memberOf([newAdmin.publicKey]);
    
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

  // Error cases
  it("Invalid resource name", async () => {
    try {
      await program.methods
        .configureResource("", tokenMint) // Empty name
        .accounts({
          admin: admin.publicKey,
          resource: PublicKey.findProgramAddressSync(
            [Buffer.from("")],
            program.programId
          )[0],
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.toString()).to.include("ResourceNameEmpty");
    }
  });

  it("Non-admin tries to update resource", async () => {
    try {
      await program.methods
        .updateResource(resourceName, tokenMint)
        .accounts({
          admin: user1.publicKey,
          resource: resourcePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
      
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.toString()).to.include("AdminPermissionDenied");
    }
  });
}); 