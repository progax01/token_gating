import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TokenGating } from "../target/types/token_gating";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  requestAirdrop,
  createTokenMint,
  setupTokenAccounts,
  findResourcePda
} from "./utils";

describe("token-gating: resource access verification", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenGating as Program<TokenGating>;
  
  // Test wallets
  const admin = anchor.web3.Keypair.generate();
  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();
  const userNoTokens = anchor.web3.Keypair.generate();

  // Test data
  const resourceName = "premium-resource";
  let resourcePda: PublicKey;
  
  // Token data
  let tokenMint: PublicKey;
  let adminTokenAccount: PublicKey;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  let userNoTokensAccount: PublicKey;
  
  before(async () => {
    // Airdrop SOL to wallets
    await requestAirdrop(provider.connection, admin, 10);
    await requestAirdrop(provider.connection, user1, 10);
    await requestAirdrop(provider.connection, user2, 10);
    await requestAirdrop(provider.connection, userNoTokens, 10);
    
    // Create token mint
    tokenMint = await createTokenMint(provider.connection, admin);
    
    // Setup token accounts with different balances
    [adminTokenAccount, user1TokenAccount, user2TokenAccount, userNoTokensAccount] = 
      await setupTokenAccounts(
        provider.connection,
        admin,
        tokenMint,
        [admin, user1, user2, userNoTokens],
        [1000, 100, 1, 0] // Admin: 1000, User1: 100, User2: 1, UserNoTokens: 0
      );
    
    // Calculate the resource PDA
    resourcePda = findResourcePda(resourceName, program.programId);
    
    // Configure the resource
    await program.methods
      .configureResource(resourceName, tokenMint)
      .accounts({
        admin: admin.publicKey,
        resource: resourcePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  });

  describe("verify_access instruction", () => {
    it("grants access when user has sufficient tokens (multiple tokens)", async () => {
      // User1 has 100 tokens, which is sufficient
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
      
      // No assertion needed - transaction success means access granted
    });

    it("grants access when user has the minimum required tokens (1 token)", async () => {
      // User2 has exactly 1 token, which is the minimum requirement
      await program.methods
        .verifyAccess(resourceName)
        .accounts({
          user: user2.publicKey,
          resource: resourcePda,
          userTokenAccount: user2TokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();
      
      // No assertion needed - transaction success means access granted
    });

    it("denies access when user has no tokens", async () => {
      try {
        await program.methods
          .verifyAccess(resourceName)
          .accounts({
            user: userNoTokens.publicKey,
            resource: resourcePda,
            userTokenAccount: userNoTokensAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([userNoTokens])
          .rpc();
        
        // If we get here, the test failed
        expect.fail("Expected transaction to fail for user with no tokens");
      } catch (error) {
        // Verify it fails with the expected error
        expect(error.toString()).to.include("InsufficientTokenBalance");
      }
    });

    it("rejects if token account doesn't belong to user", async () => {
      try {
        // Try to use user1's token account for user2
        await program.methods
          .verifyAccess(resourceName)
          .accounts({
            user: user2.publicKey,
            resource: resourcePda,
            userTokenAccount: user1TokenAccount, // This is user1's account, not user2's
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();
        
        expect.fail("Expected transaction to fail for mismatched token account owner");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTokenAccountOwner");
      }
    });

    it("fails for non-existent resource", async () => {
      const nonExistentResourceName = "non-existent-resource";
      const nonExistentResourcePda = findResourcePda(nonExistentResourceName, program.programId);
      
      try {
        await program.methods
          .verifyAccess(nonExistentResourceName)
          .accounts({
            user: user1.publicKey,
            resource: nonExistentResourcePda,
            userTokenAccount: user1TokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        
        expect.fail("Expected transaction to fail for non-existent resource");
      } catch (error) {
        // This should fail when trying to deserialize the non-existent account
        expect(error.toString()).to.include("Account does not exist");
      }
    });
  });

  describe("resource management", () => {
    it("allows admin to update resource mint", async () => {
      // Create a new mint
      const newMint = await createTokenMint(provider.connection, admin);
      
      // Update the resource to use the new mint
      await program.methods
        .updateResource(resourceName, newMint)
        .accounts({
          admin: admin.publicKey,
          resource: resourcePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      // Fetch the resource and verify the mint was updated
      const resource = await program.account.resource.fetch(resourcePda);
      expect(resource.requiredMint.toBase58()).to.equal(newMint.toBase58());
      
      // Revert to original mint for other tests
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

    it("prevents non-admin from updating resource", async () => {
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
        
        expect.fail("Expected transaction to fail for non-admin");
      } catch (error) {
        expect(error.toString()).to.include("AdminPermissionDenied");
      }
    });

    it("enforces resource name validation on create", async () => {
      // Try with an empty resource name
      try {
        const emptyResourceName = "";
        const emptyResourcePda = findResourcePda(emptyResourceName, program.programId);
        
        await program.methods
          .configureResource(emptyResourceName, tokenMint)
          .accounts({
            admin: admin.publicKey,
            resource: emptyResourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for empty resource name");
      } catch (error) {
        expect(error.toString()).to.include("ResourceNameEmpty");
      }

      // Try with a very long resource name (longer than 32 chars)
      try {
        const longResourceName = "this-resource-name-is-way-too-long-for-the-program-to-accept";
        const longResourcePda = findResourcePda(longResourceName, program.programId);
        
        await program.methods
          .configureResource(longResourceName, tokenMint)
          .accounts({
            admin: admin.publicKey,
            resource: longResourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for long resource name");
      } catch (error) {
        expect(error.toString()).to.include("ResourceNameTooLong");
      }

      // Try with invalid characters in name
      try {
        const invalidResourceName = "invalid!@#resource";
        const invalidResourcePda = findResourcePda(invalidResourceName, program.programId);
        
        await program.methods
          .configureResource(invalidResourceName, tokenMint)
          .accounts({
            admin: admin.publicKey,
            resource: invalidResourcePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Expected transaction to fail for invalid resource name");
      } catch (error) {
        expect(error.toString()).to.include("InvalidResourceName");
      }
    });
  });
}); 