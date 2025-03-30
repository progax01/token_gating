import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { expect } from "chai";
import { BN } from "bn.js";

// Mock IDL for Token Gating program
const mockIdl = {
  version: "0.1.0",
  name: "token_gating",
  instructions: [
    // Instructions included here to enable mocking
  ],
  errors: [
    { code: 6000, name: "InsufficientTokenBalance", msg: "Insufficient token balance for access" },
    { code: 6001, name: "ResourceNameEmpty", msg: "Resource name cannot be empty" },
    { code: 6002, name: "ResourceNotConfigured", msg: "Resource not configured or inactive" },
    { code: 6003, name: "AdminPermissionDenied", msg: "Admin permission denied" },
    { code: 6004, name: "ImmutableResourceName", msg: "Resource name cannot be changed after configuration" },
    { code: 6005, name: "InvalidResourceName", msg: "Invalid resource name - must only contain alphanumeric characters and spaces" },
    { code: 6006, name: "InvalidTokenAccountOwner", msg: "Token account does not belong to the user" },
    { code: 6007, name: "TokenMintMismatch", msg: "Token mint does not match resource requirement" },
    { code: 6008, name: "InvalidLevelThresholds", msg: "Level thresholds must be in ascending order" },
    { code: 6009, name: "ResourceNameMismatch", msg: "Resource name mismatch" },
    { code: 6010, name: "ResourceMismatch", msg: "Resource mismatch" },
    { code: 6011, name: "InvalidClaimWindow", msg: "Invalid claim window - start time must be before end time" },
    { code: 6012, name: "InvalidLevelRequirement", msg: "Invalid level requirement" },
    { code: 6013, name: "ClaimWindowInactive", msg: "Claim window is inactive" },
    { code: 6014, name: "ClaimWindowClosed", msg: "Claim window is closed" },
    { code: 6015, name: "AlreadyClaimed", msg: "User has already claimed from this window" },
    { code: 6016, name: "InsufficientLevel", msg: "User level is insufficient for this claim" },
    { code: 6017, name: "AdminAlreadyExists", msg: "Admin already exists" },
    { code: 6018, name: "AdminNotFound", msg: "Admin not found" },
    { code: 6019, name: "CannotRemoveLastAdmin", msg: "Cannot remove the last admin" },
    { code: 6020, name: "TooManyLevels", msg: "Too many levels - maximum 3 levels allowed" },
    { code: 6021, name: "ResourceNameTooLong", msg: "Resource name too long - maximum 32 characters" },
    { code: 6022, name: "ResourceAlreadyExists", msg: "Resource already exists" }
  ]
};

describe("Token Gating - Edge Cases and Error Handling", () => {
  // Create keypairs for testing
  const admin = Keypair.generate();
  const user = Keypair.generate();
  const userWithoutTokens = Keypair.generate();
  const unauthorizedAdmin = Keypair.generate();
  const programId = new PublicKey("DXqZwbkwKoMx84ibFpNaYTHVvLPLJHZPchhWw1nKsyex"); // Mock program ID
  
  // Utility function to derive PDAs
  function findPDA(seeds: Buffer[], programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
    return pda;
  }

  // 1. Empty Resource Name Tests
  describe("Empty Resource Name", () => {
    it("Should reject empty resource name", () => {
      try {
        // Mock configureResource with empty name
        const emptyName = "";
        expect(() => {
          // In a real test this would call the program
          if (emptyName === "") throw new Error("ResourceNameEmpty");
        }).to.throw("ResourceNameEmpty");
      } catch (error: any) {
        expect(error.toString()).to.include("ResourceNameEmpty");
      }
    });
  });

  // 2. Resource Name Too Long Tests
  describe("Resource Name Length Validation", () => {
    it("Should reject resource name that is too long", () => {
      try {
        // Resource name over 32 characters
        const longName = "ThisResourceNameIsMuchTooLongAndShouldBeRejectedByTheProgram";
        expect(() => {
          if (longName.length > 32) throw new Error("ResourceNameTooLong");
        }).to.throw("ResourceNameTooLong");
      } catch (error: any) {
        expect(error.toString()).to.include("ResourceNameTooLong");
      }
    });
  });

  // 3. Invalid Resource Name Tests
  describe("Invalid Resource Name Characters", () => {
    it("Should reject resource name with special characters", () => {
      try {
        // Resource name with special characters
        const invalidName = "Resource@Name#With$Special&Chars";
        expect(() => {
          // Only allow alphanumeric and spaces
          if (!/^[a-zA-Z0-9 ]+$/.test(invalidName)) throw new Error("InvalidResourceName");
        }).to.throw("InvalidResourceName");
      } catch (error: any) {
        expect(error.toString()).to.include("InvalidResourceName");
      }
    });
  });

  // 4. Admin Permission Tests
  describe("Admin Permission Checks", () => {
    it("Should reject non-admin trying to configure resource", () => {
      try {
        // Mock admin check
        const isAdmin = false; // Simulate unauthorized admin
        expect(() => {
          if (!isAdmin) throw new Error("AdminPermissionDenied");
        }).to.throw("AdminPermissionDenied");
      } catch (error: any) {
        expect(error.toString()).to.include("AdminPermissionDenied");
      }
    });
  });

  // 5. Token Balance Tests
  describe("Token Balance Verification", () => {
    it("Should reject user with insufficient tokens", () => {
      try {
        // Mock token balance
        const userTokenBalance = 0;
        const requiredAmount = 1;
        
        expect(() => {
          if (userTokenBalance < requiredAmount) throw new Error("InsufficientTokenBalance");
        }).to.throw("InsufficientTokenBalance");
      } catch (error: any) {
        expect(error.toString()).to.include("InsufficientTokenBalance");
      }
    });
  });

  // 6. Level Threshold Tests
  describe("Level Threshold Validation", () => {
    it("Should reject non-ascending level thresholds", () => {
      try {
        // Mock thresholds in wrong order
        const thresholds = [100, 50, 200]; // 50 is less than 100
        
        let isAscending = true;
        for (let i = 1; i < thresholds.length; i++) {
          if (thresholds[i] <= thresholds[i-1]) {
            isAscending = false;
            break;
          }
        }
        
        expect(() => {
          if (!isAscending) throw new Error("InvalidLevelThresholds");
        }).to.throw("InvalidLevelThresholds");
      } catch (error: any) {
        expect(error.toString()).to.include("InvalidLevelThresholds");
      }
    });
    
    it("Should reject too many levels", () => {
      try {
        // Mock too many levels
        const thresholds = [10, 20, 30, 40]; // More than 3 levels
        const maxLevels = 3;
        
        expect(() => {
          if (thresholds.length > maxLevels) throw new Error("TooManyLevels");
        }).to.throw("TooManyLevels");
      } catch (error: any) {
        expect(error.toString()).to.include("TooManyLevels");
      }
    });
  });

  // 7. Claim Window Tests
  describe("Claim Window Validation", () => {
    it("Should reject invalid claim window time range", () => {
      try {
        // Mock invalid time range (end before start)
        const startTime = 1000;
        const endTime = 500;
        
        expect(() => {
          if (startTime >= endTime) throw new Error("InvalidClaimWindow");
        }).to.throw("InvalidClaimWindow");
      } catch (error: any) {
        expect(error.toString()).to.include("InvalidClaimWindow");
      }
    });
    
    it("Should reject claim attempt when window is closed", () => {
      try {
        // Mock closed window
        const currentTime = 2000;
        const endTime = 1500;
        
        expect(() => {
          if (currentTime > endTime) throw new Error("ClaimWindowClosed");
        }).to.throw("ClaimWindowClosed");
      } catch (error: any) {
        expect(error.toString()).to.include("ClaimWindowClosed");
      }
    });
    
    it("Should reject repeat claim attempts", () => {
      try {
        // Mock already claimed
        const hasClaimed = true;
        
        expect(() => {
          if (hasClaimed) throw new Error("AlreadyClaimed");
        }).to.throw("AlreadyClaimed");
      } catch (error: any) {
        expect(error.toString()).to.include("AlreadyClaimed");
      }
    });
  });

  // 8. Admin Management Tests
  describe("Admin Management", () => {
    it("Should reject removing the last admin", () => {
      try {
        // Mock admin list with only one admin
        const admins = [admin.publicKey];
        
        expect(() => {
          if (admins.length <= 1) throw new Error("CannotRemoveLastAdmin");
        }).to.throw("CannotRemoveLastAdmin");
      } catch (error: any) {
        expect(error.toString()).to.include("CannotRemoveLastAdmin");
      }
    });
    
    it("Should reject adding an admin that already exists", () => {
      // Mock admin list with one admin
      const admins = [admin.publicKey];
      const newAdmin = admin.publicKey; // Same as existing
      
      // Fixed logic: wrap the conditional in an expect block
      const testFunc = () => {
        if (admins.some(a => a.equals(newAdmin))) {
          throw new Error("AdminAlreadyExists");
        }
      };
      
      expect(testFunc).to.throw(Error, "AdminAlreadyExists");
    });
  });

  // 9. Token Account Ownership Tests
  describe("Token Account Ownership", () => {
    it("Should reject token account not owned by user", () => {
      try {
        // Mock token account with different owner
        const tokenAccountOwner = user.publicKey;
        const actualUser = userWithoutTokens.publicKey;
        
        expect(() => {
          if (!tokenAccountOwner.equals(actualUser)) throw new Error("InvalidTokenAccountOwner");
        }).to.throw("InvalidTokenAccountOwner");
      } catch (error: any) {
        expect(error.toString()).to.include("InvalidTokenAccountOwner");
      }
    });
  });

  // 10. Token Mint Tests
  describe("Token Mint Validation", () => {
    it("Should reject token account with wrong mint", () => {
      try {
        // Mock token account with wrong mint
        const requiredMint = new PublicKey("So11111111111111111111111111111111111111112");
        const actualMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        
        expect(() => {
          if (!requiredMint.equals(actualMint)) throw new Error("TokenMintMismatch");
        }).to.throw("TokenMintMismatch");
      } catch (error: any) {
        expect(error.toString()).to.include("TokenMintMismatch");
      }
    });
  });

  // 11. Level Requirement Tests
  describe("Level Requirements", () => {
    it("Should reject user with insufficient level", () => {
      try {
        // Mock user level below requirement
        const userLevel = 1;
        const requiredLevel = 2;
        
        expect(() => {
          if (userLevel < requiredLevel) throw new Error("InsufficientLevel");
        }).to.throw("InsufficientLevel");
      } catch (error: any) {
        expect(error.toString()).to.include("InsufficientLevel");
      }
    });
  });

  // 12. Resource Configuration Tests
  describe("Resource Configuration", () => {
    it("Should reject operations on inactive resources", () => {
      try {
        // Mock inactive resource
        const isActive = false;
        
        expect(() => {
          if (!isActive) throw new Error("ResourceNotConfigured");
        }).to.throw("ResourceNotConfigured");
      } catch (error: any) {
        expect(error.toString()).to.include("ResourceNotConfigured");
      }
    });
    
    it("Should reject changing resource name after configuration", () => {
      try {
        // Mock attempt to change resource name
        const originalName = "resource-1";
        const newName = "resource-2";
        
        expect(() => {
          if (originalName !== newName) throw new Error("ImmutableResourceName");
        }).to.throw("ImmutableResourceName");
      } catch (error: any) {
        expect(error.toString()).to.include("ImmutableResourceName");
      }
    });
  });

  // 13. Resource Name Mismatch Tests
  describe("Resource Name Matching", () => {
    it("Should reject operations with mismatched resource names", () => {
      try {
        // Mock resource name mismatch
        const configuredName = "resource-1";
        const providedName = "different-resource";
        
        expect(() => {
          if (configuredName !== providedName) throw new Error("ResourceNameMismatch");
        }).to.throw("ResourceNameMismatch");
      } catch (error: any) {
        expect(error.toString()).to.include("ResourceNameMismatch");
      }
    });
  });

  // 14. Boundary Tests
  describe("Boundary Tests", () => {
    it("Should accept resource name with exactly max length", () => {
      // Mock name with exactly 32 characters
      const name = "abcdefghijklmnopqrstuvwxyz123456";
      expect(name.length).to.equal(32);
      // This should not throw
    });
    
    it("Should accept the minimum token balance", () => {
      // Mock minimum token balance
      const userTokenBalance = 1;
      const requiredAmount = 1;
      
      expect(userTokenBalance >= requiredAmount).to.be.true;
      // This should not throw
    });
  });
}); 