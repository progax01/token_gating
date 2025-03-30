use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

declare_id!("EHyipzMTK3FV63inZTyvqmSYqFxDdKJPKMhHay6yQ9mw");
#[program]
pub mod token_gating {
    use super::*;

    // 1A: Configure a new resource-token mapping
    pub fn configure_resource(
        ctx: Context<ConfigureResource>,
        name: String,
        required_mint: Pubkey,
    ) -> Result<()> {
        // Validations
        require!(!name.is_empty(), ErrorCode::ResourceNameEmpty);
        require!(name.len() <= Resource::MAX_NAME_LENGTH, ErrorCode::ResourceNameTooLong);
        require!(validate_resource_name(&name), ErrorCode::InvalidResourceName);

        let resource = &mut ctx.accounts.resource;
        resource.name = name;
        resource.required_mint = required_mint;
        resource.admin = ctx.accounts.admin.key();
        resource.is_active = true;
        
        emit!(ResourceConfigured {
            resource: resource.name.clone(),
            required_mint,
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    // 1A: Update an existing resource-token mapping
    pub fn update_resource(
        ctx: Context<UpdateResource>,
        name: String,
        new_mint: Pubkey,
    ) -> Result<()> {
        let resource = &mut ctx.accounts.resource;
        
        // Validate resource exists and admin is authorized
        require!(resource.is_active, ErrorCode::ResourceNotConfigured);
        require!(resource.name == name, ErrorCode::ImmutableResourceName);
        
        // Update the mint
        resource.required_mint = new_mint;
        
        emit!(ResourceUpdated {
            resource: resource.name.clone(),
            new_mint,
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    // 1B: Verify user access to a resource
    pub fn verify_access(ctx: Context<VerifyAccess>, resource_name: String) -> Result<()> {
        let resource = &ctx.accounts.resource;
        let user_token_account = &ctx.accounts.user_token_account;
        let user = &ctx.accounts.user;

        // Check if token account belongs to user
        require!(
            user_token_account.owner == user.key(),
            ErrorCode::InvalidTokenAccountOwner
        );

        // Check if token account mint matches resource's required mint
        require!(
            user_token_account.mint == resource.required_mint,
            ErrorCode::TokenMintMismatch
        );

        // Verify token balance (minimum 1 token required)
        if user_token_account.amount >= 1 {
            emit!(AccessGranted {
                user: user.key(),
                resource: resource_name,
                timestamp: Clock::get()?.unix_timestamp,
            });
            Ok(())
        } else {
            emit!(AccessDenied {
                user: user.key(),
                resource: resource_name,
                reason: "InsufficientTokenBalance".to_string(),
                timestamp: Clock::get()?.unix_timestamp,
            });
            Err(ErrorCode::InsufficientTokenBalance.into())
        }
    }

    // 2A: Configure level thresholds for a resource
    pub fn configure_levels(
        ctx: Context<ConfigureLevels>,
        resource_name: String,
        thresholds: Vec<u64>,
    ) -> Result<()> {
        let levels = &mut ctx.accounts.levels;
        let resource = &ctx.accounts.resource;

        // Ensure resource exists and admin is authorized
        require!(resource.is_active, ErrorCode::ResourceNotConfigured);
        require!(resource.name == resource_name, ErrorCode::ResourceNameMismatch);
        require!(resource.admin == ctx.accounts.admin.key(), ErrorCode::AdminPermissionDenied);
        
        // Validate thresholds - must be in ascending order and within limits
        require!(thresholds.len() <= Levels::MAX_LEVELS, ErrorCode::InvalidLevelThresholds);
        
        for i in 1..thresholds.len() {
            require!(
                thresholds[i] > thresholds[i-1],
                ErrorCode::InvalidLevelThresholds
            );
        }

        // Store the levels
        levels.resource = resource.key();
        levels.thresholds = thresholds.clone();
        levels.last_updated = Clock::get()?.unix_timestamp;
        
        emit!(LevelsConfigured {
            resource: resource_name,
            thresholds,
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    // 2A: Check user level based on token balance
    pub fn check_level(ctx: Context<CheckLevel>, resource_name: String) -> Result<()> {
        let levels = &ctx.accounts.levels;
        let user_token_account = &ctx.accounts.user_token_account;
        let user = &ctx.accounts.user;
        
        // Check token account owner
        require!(
            user_token_account.owner == user.key(),
            ErrorCode::InvalidTokenAccountOwner
        );
        
        // Find the user's level based on token balance
        let balance = user_token_account.amount;
        let mut user_level = 0;
        
        for (i, threshold) in levels.thresholds.iter().enumerate() {
            if balance >= *threshold {
                user_level = i as u8 + 1;
            } else {
                break;
            }
        }
        
        emit!(UserLevel {
            user: user.key(),
            resource: resource_name,
            level: user_level,
            balance,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    // 2B: Configure a token claim window
    pub fn configure_claim(
        ctx: Context<ConfigureClaim>,
        resource_name: String,
        start_time: i64,
        end_time: i64,
        required_level: u8,
    ) -> Result<()> {
        let claim_window = &mut ctx.accounts.claim_window;
        let resource = &ctx.accounts.resource;
        
        // Validations
        require!(resource.is_active, ErrorCode::ResourceNotConfigured);
        require!(resource.name == resource_name, ErrorCode::ResourceNameMismatch);
        require!(
            start_time < end_time,
            ErrorCode::InvalidClaimWindow
        );
        require!(
            required_level > 0,
            ErrorCode::InvalidLevelRequirement
        );
        
        // Set up claim window
        claim_window.resource = resource.key();
        claim_window.start_time = start_time;
        claim_window.end_time = end_time;
        claim_window.required_level = required_level;
        claim_window.is_active = true;
        
        emit!(ClaimWindowConfigured {
            resource: resource_name,
            start_time,
            end_time,
            required_level,
            admin: ctx.accounts.admin.key(),
        });
        
        Ok(())
    }

    // 2B: Claim a token reward
    pub fn claim_token(ctx: Context<ClaimToken>, resource_name: String) -> Result<()> {
        let claim_window = &ctx.accounts.claim_window;
        let user_claim = &mut ctx.accounts.user_claim;
        let user = &ctx.accounts.user;
        
        // Check if claim window is active
        require!(claim_window.is_active, ErrorCode::ClaimWindowInactive);
        
        // Check current time is within claim window
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= claim_window.start_time && current_time <= claim_window.end_time,
            ErrorCode::ClaimWindowClosed
        );
        
        // Check if user has claimed already
        require!(
            !user_claim.has_claimed,
            ErrorCode::AlreadyClaimed
        );
        
        // Get the levels account - using the levels account directly instead of deserializing
        let levels = &ctx.accounts.levels;
        let user_token_account = &ctx.accounts.user_token_account;
        
        // Verify token account belongs to user
        require!(
            user_token_account.owner == user.key(),
            ErrorCode::InvalidTokenAccountOwner
        );
        
        // Calculate user level based on balance
        let balance = user_token_account.amount;
        let mut user_level = 0;
        
        for (i, threshold) in levels.thresholds.iter().enumerate() {
            if balance >= *threshold {
                user_level = i as u8 + 1;
            } else {
                break;
            }
        }
        
        // Check if user meets level requirement
        require!(
            user_level >= claim_window.required_level,
            ErrorCode::InsufficientLevel
        );
        
        // Mark as claimed
        user_claim.user = user.key();
        user_claim.claim_window = claim_window.key();
        user_claim.has_claimed = true;
        user_claim.claimed_at = current_time;
        
        emit!(TokenClaimed {
            user: user.key(),
            resource: resource_name,
            level: user_level,
            timestamp: current_time,
        });
        
        Ok(())
    }

    // Add admin - for allowing multiple admins through multisig
    pub fn add_admin(ctx: Context<AddAdmin>, new_admin: Pubkey) -> Result<()> {
        let admin_list = &mut ctx.accounts.admin_list;
        
        // Check if this is the first admin being added
        if admin_list.admins.is_empty() {
            admin_list.admins.push(ctx.accounts.admin.key());
        }
        
        // Check if admin is already in the list
        require!(
            !admin_list.admins.contains(&new_admin),
            ErrorCode::AdminAlreadyExists
        );
        
        // Add the new admin
        admin_list.admins.push(new_admin);
        
        emit!(AdminAdded {
            admin: ctx.accounts.admin.key(),
            new_admin,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    // Remove admin - for security purposes
    pub fn remove_admin(ctx: Context<RemoveAdmin>, admin_to_remove: Pubkey) -> Result<()> {
        let admin_list = &mut ctx.accounts.admin_list;
        
        // Ensure admin exists
        let position = admin_list.admins.iter().position(|&x| x == admin_to_remove);
        require!(position.is_some(), ErrorCode::AdminNotFound);
        
        // Ensure we're not removing the last admin
        require!(admin_list.admins.len() > 1, ErrorCode::CannotRemoveLastAdmin);
        
        // Remove the admin
        let position = position.unwrap();
        admin_list.admins.remove(position);
        
        emit!(AdminRemoved {
            admin: ctx.accounts.admin.key(),
            removed_admin: admin_to_remove,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

// Instruction contexts
#[derive(Accounts)]
#[instruction(name: String, required_mint: Pubkey)]
pub struct ConfigureResource<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + Resource::SPACE,
        seeds = [name.as_bytes()],
        bump
    )]
    pub resource: Account<'info, Resource>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, new_mint: Pubkey)]
pub struct UpdateResource<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [resource.name.as_bytes()],
        bump,
        constraint = resource.admin == admin.key() @ ErrorCode::AdminPermissionDenied
    )]
    pub resource: Account<'info, Resource>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(resource_name: String)]
pub struct VerifyAccess<'info> {
    pub user: Signer<'info>,
    
    #[account(
        seeds = [resource_name.as_bytes()],
        bump,
        constraint = resource.is_active @ ErrorCode::ResourceNotConfigured
    )]
    pub resource: Account<'info, Resource>,
    
    #[account(
        constraint = user_token_account.mint == resource.required_mint @ ErrorCode::TokenMintMismatch
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(resource_name: String, thresholds: Vec<u64>)]
pub struct ConfigureLevels<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        seeds = [resource_name.as_bytes()],
        bump,
        constraint = resource.admin == admin.key() @ ErrorCode::AdminPermissionDenied
    )]
    pub resource: Account<'info, Resource>,
    
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Levels::SPACE,
        seeds = [b"levels", resource.key().as_ref()],
        bump
    )]
    pub levels: Account<'info, Levels>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(resource_name: String)]
pub struct CheckLevel<'info> {
    pub user: Signer<'info>,
    
    #[account(
        seeds = [resource_name.as_bytes()],
        bump,
        constraint = resource.is_active @ ErrorCode::ResourceNotConfigured
    )]
    pub resource: Account<'info, Resource>,
    
    #[account(
        seeds = [b"levels", resource.key().as_ref()],
        bump
    )]
    pub levels: Account<'info, Levels>,
    
    #[account(
        constraint = user_token_account.mint == resource.required_mint @ ErrorCode::TokenMintMismatch
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(resource_name: String, start_time: i64, end_time: i64, required_level: u8)]
pub struct ConfigureClaim<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        seeds = [resource_name.as_bytes()],
        bump,
        constraint = resource.admin == admin.key() @ ErrorCode::AdminPermissionDenied
    )]
    pub resource: Account<'info, Resource>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + ClaimWindow::SPACE,
        seeds = [b"claim", resource.key().as_ref(), start_time.to_le_bytes().as_ref()],
        bump
    )]
    pub claim_window: Account<'info, ClaimWindow>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(resource_name: String)]
pub struct ClaimToken<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        seeds = [resource_name.as_bytes()],
        bump,
        constraint = resource.is_active @ ErrorCode::ResourceNotConfigured
    )]
    pub resource: Account<'info, Resource>,
    
    #[account(
        seeds = [b"levels", resource.key().as_ref()],
        bump
    )]
    pub levels: Account<'info, Levels>,
    
    #[account(
        constraint = claim_window.resource == resource.key() @ ErrorCode::ResourceMismatch
    )]
    pub claim_window: Account<'info, ClaimWindow>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserClaim::SPACE,
        seeds = [b"user_claim", claim_window.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_claim: Account<'info, UserClaim>,
    
    #[account(
        constraint = user_token_account.mint == resource.required_mint @ ErrorCode::TokenMintMismatch
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AddAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + AdminList::SPACE,
        seeds = [b"admin_list"],
        bump
    )]
    pub admin_list: Account<'info, AdminList>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"admin_list"],
        bump,
        constraint = admin_list.admins.contains(&admin.key()) @ ErrorCode::AdminPermissionDenied
    )]
    pub admin_list: Account<'info, AdminList>,
    
    pub system_program: Program<'info, System>,
}

// State accounts
#[account]
pub struct Resource {
    pub name: String,          // 4 + 32 (reduced max name length)
    pub required_mint: Pubkey, // 32
    pub admin: Pubkey,         // 32
    pub is_active: bool,       // 1
}

impl Resource {
    pub const MAX_NAME_LENGTH: usize = 32; // Limit name length
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1;
}

#[account]
pub struct Levels {
    pub resource: Pubkey,       // 32
    pub thresholds: Vec<u64>,   // 4 + (8 * max 3 levels)
    pub last_updated: i64,      // 8
}

impl Levels {
    pub const MAX_LEVELS: usize = 3;
    pub const SPACE: usize = 32 + 4 + (8 * 3) + 8;
}

#[account]
pub struct ClaimWindow {
    pub resource: Pubkey,       // 32
    pub start_time: i64,        // 8
    pub end_time: i64,          // 8
    pub required_level: u8,     // 1
    pub is_active: bool,        // 1
}

impl ClaimWindow {
    pub const SPACE: usize = 32 + 8 + 8 + 1 + 1;
}

#[account]
pub struct UserClaim {
    pub user: Pubkey,           // 32
    pub claim_window: Pubkey,   // 32
    pub has_claimed: bool,      // 1
    pub claimed_at: i64,        // 8
}

impl UserClaim {
    pub const SPACE: usize = 32 + 32 + 1 + 8;
}

#[account]
pub struct AdminList {
    pub admins: Vec<Pubkey>,    // 4 + (32 * max 3 admins)
}

impl AdminList {
    pub const MAX_ADMINS: usize = 3;
    pub const SPACE: usize = 4 + (32 * 3);
}

// Events
#[event]
pub struct ResourceConfigured {
    pub resource: String,
    pub required_mint: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct ResourceUpdated {
    pub resource: String,
    pub new_mint: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct AccessGranted {
    pub user: Pubkey,
    pub resource: String,
    pub timestamp: i64,
}

#[event]
pub struct AccessDenied {
    pub user: Pubkey,
    pub resource: String,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct LevelsConfigured {
    pub resource: String,
    pub thresholds: Vec<u64>,
    pub admin: Pubkey,
}

#[event]
pub struct UserLevel {
    pub user: Pubkey,
    pub resource: String,
    pub level: u8,
    pub balance: u64,
    pub timestamp: i64,
}

#[event]
pub struct ClaimWindowConfigured {
    pub resource: String,
    pub start_time: i64,
    pub end_time: i64,
    pub required_level: u8,
    pub admin: Pubkey,
}

#[event]
pub struct TokenClaimed {
    pub user: Pubkey,
    pub resource: String,
    pub level: u8,
    pub timestamp: i64,
}

#[event]
pub struct AdminAdded {
    pub admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AdminRemoved {
    pub admin: Pubkey,
    pub removed_admin: Pubkey,
    pub timestamp: i64,
}

// Error codes
#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient token balance for access")]
    InsufficientTokenBalance,
    
    #[msg("Resource name cannot be empty")]
    ResourceNameEmpty,
    
    #[msg("Resource not configured or inactive")]
    ResourceNotConfigured,
    
    #[msg("Admin permission denied")]
    AdminPermissionDenied,
    
    #[msg("Resource name cannot be changed after configuration")]
    ImmutableResourceName,
    
    #[msg("Invalid resource name - must only contain alphanumeric characters and spaces")]
    InvalidResourceName,
    
    #[msg("Token account does not belong to the user")]
    InvalidTokenAccountOwner,
    
    #[msg("Token mint does not match resource requirement")]
    TokenMintMismatch,
    
    #[msg("Level thresholds must be in ascending order")]
    InvalidLevelThresholds,
    
    #[msg("Resource name mismatch")]
    ResourceNameMismatch,
    
    #[msg("Resource mismatch")]
    ResourceMismatch,
    
    #[msg("Invalid claim window - start time must be before end time")]
    InvalidClaimWindow,
    
    #[msg("Invalid level requirement")]
    InvalidLevelRequirement,
    
    #[msg("Claim window is inactive")]
    ClaimWindowInactive,
    
    #[msg("Claim window is closed")]
    ClaimWindowClosed,
    
    #[msg("User has already claimed from this window")]
    AlreadyClaimed,
    
    #[msg("User level is insufficient for this claim")]
    InsufficientLevel,
    
    #[msg("Admin already exists")]
    AdminAlreadyExists,
    
    #[msg("Admin not found")]
    AdminNotFound,
    
    #[msg("Cannot remove the last admin")]
    CannotRemoveLastAdmin,
    
    #[msg("Too many levels - maximum 3 levels allowed")]
    TooManyLevels,
    
    #[msg("Resource name too long - maximum 32 characters")]
    ResourceNameTooLong,
    
    #[msg("Resource already exists")]
    ResourceAlreadyExists,
}

// Helper functions
fn validate_resource_name(name: &str) -> bool {
    name.chars().all(|c| c.is_alphanumeric() || c.is_whitespace())
} 