use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL");

pub const SIDE_NO: u8 = 0;
pub const SIDE_YES: u8 = 1;
pub const PRICE_SCALE: u64 = 1_000_000_000;

#[program]
pub mod probx_prediction {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        end_time: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(!question.trim().is_empty(), PredictionError::EmptyQuestion);
        require!(
            question.as_bytes().len() <= Market::MAX_QUESTION_BYTES,
            PredictionError::QuestionTooLong
        );
        require!(
            end_time > clock.unix_timestamp,
            PredictionError::InvalidEndTime
        );

        let creator = ctx.accounts.creator.key();
        let market = &mut ctx.accounts.market;

        market.id = Market::derive_id(&creator, end_time, question.as_bytes());
        market.question = question.clone();
        market.creator = creator;
        market.resolver = creator;
        market.yes_pool = 0;
        market.no_pool = 0;
        market.total_liquidity = 0;
        market.end_time = end_time;
        market.resolved = false;
        market.outcome = SIDE_NO;

        emit!(MarketCreated {
            market: market.key(),
            id: market.id,
            creator,
            resolver: creator,
            question,
            end_time,
        });

        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, side: u8) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(amount > 0, PredictionError::InvalidAmount);
        require!(
            side == SIDE_NO || side == SIDE_YES,
            PredictionError::InvalidSide
        );
        require!(!market.resolved, PredictionError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp < market.end_time,
            PredictionError::MarketClosed
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: market.to_account_info(),
                },
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.owner.key();
            position.market = market.key();
        }

        if side == SIDE_YES {
            market.yes_pool = market
                .yes_pool
                .checked_add(amount)
                .ok_or(PredictionError::MathOverflow)?;
            position.yes_amount = position
                .yes_amount
                .checked_add(amount)
                .ok_or(PredictionError::MathOverflow)?;
        } else {
            market.no_pool = market
                .no_pool
                .checked_add(amount)
                .ok_or(PredictionError::MathOverflow)?;
            position.no_amount = position
                .no_amount
                .checked_add(amount)
                .ok_or(PredictionError::MathOverflow)?;
        }

        market.total_liquidity = market
            .total_liquidity
            .checked_add(amount)
            .ok_or(PredictionError::MathOverflow)?;

        emit!(BetPlaced {
            market: market.key(),
            bettor: ctx.accounts.owner.key(),
            side,
            amount,
            yes_pool: market.yes_pool,
            no_pool: market.no_pool,
            total_liquidity: market.total_liquidity,
        });

        Ok(())
    }

    /// Returns YES probability as fixed point scaled by PRICE_SCALE.
    /// For example, 0.25 is returned as 250_000_000.
    pub fn get_price(ctx: Context<GetPrice>) -> Result<u64> {
        let market = &ctx.accounts.market;

        if market.total_liquidity == 0 {
            return Ok(0);
        }

        let price = (market.yes_pool as u128)
            .checked_mul(PRICE_SCALE as u128)
            .ok_or(PredictionError::MathOverflow)?
            .checked_div(market.total_liquidity as u128)
            .ok_or(PredictionError::MathOverflow)?;

        u64::try_from(price).map_err(|_| PredictionError::MathOverflow.into())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: u8) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(
            outcome == SIDE_NO || outcome == SIDE_YES,
            PredictionError::InvalidSide
        );
        require!(!market.resolved, PredictionError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp >= market.end_time,
            PredictionError::MarketNotEnded
        );

        market.outcome = outcome;
        market.resolved = true;

        emit!(MarketResolved {
            market: market.key(),
            resolver: ctx.accounts.resolver.key(),
            outcome,
            yes_pool: market.yes_pool,
            no_pool: market.no_pool,
            total_liquidity: market.total_liquidity,
        });

        Ok(())
    }

    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        let market = &ctx.accounts.market;

        require!(market.resolved, PredictionError::MarketNotResolved);

        let winning_pool = if market.outcome == SIDE_YES {
            market.yes_pool
        } else {
            market.no_pool
        };
        require!(winning_pool > 0, PredictionError::EmptyWinningPool);

        let position = &mut ctx.accounts.position;
        let user_amount = if market.outcome == SIDE_YES {
            position.yes_amount
        } else {
            position.no_amount
        };
        require!(user_amount > 0, PredictionError::NoWinningPosition);

        let payout = (user_amount as u128)
            .checked_mul(market.total_liquidity as u128)
            .ok_or(PredictionError::MathOverflow)?
            .checked_div(winning_pool as u128)
            .ok_or(PredictionError::MathOverflow)?;
        let payout = u64::try_from(payout).map_err(|_| PredictionError::MathOverflow)?;

        position.yes_amount = 0;
        position.no_amount = 0;

        let market_info = ctx.accounts.market.to_account_info();
        let owner_info = ctx.accounts.owner.to_account_info();
        let rent_exempt_min = Rent::get()?.minimum_balance(Market::SPACE);
        let market_lamports = market_info.lamports();
        let available = market_lamports
            .checked_sub(rent_exempt_min)
            .ok_or(PredictionError::InsufficientMarketLamports)?;
        require!(
            available >= payout,
            PredictionError::InsufficientMarketLamports
        );

        **market_info.try_borrow_mut_lamports()? = market_lamports
            .checked_sub(payout)
            .ok_or(PredictionError::MathOverflow)?;
        **owner_info.try_borrow_mut_lamports()? = owner_info
            .lamports()
            .checked_add(payout)
            .ok_or(PredictionError::MathOverflow)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(question: String, end_time: i64)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
        seeds = [
            Market::SEED_PREFIX,
            creator.key().as_ref(),
            &end_time.to_le_bytes(),
        ],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [
            Market::SEED_PREFIX,
            market.creator.as_ref(),
            &market.end_time.to_le_bytes(),
        ],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = owner,
        space = Position::SPACE,
        seeds = [
            Position::SEED_PREFIX,
            market.key().as_ref(),
            owner.key().as_ref(),
        ],
        bump,
        constraint = position.owner == Pubkey::default() || position.owner == owner.key() @ PredictionError::InvalidPositionOwner,
        constraint = position.market == Pubkey::default() || position.market == market.key() @ PredictionError::InvalidPositionMarket
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    #[account(
        seeds = [
            Market::SEED_PREFIX,
            market.creator.as_ref(),
            &market.end_time.to_le_bytes(),
        ],
        bump
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(
        mut,
        has_one = resolver @ PredictionError::UnauthorizedResolver,
        seeds = [
            Market::SEED_PREFIX,
            market.creator.as_ref(),
            &market.end_time.to_le_bytes(),
        ],
        bump
    )]
    pub market: Account<'info, Market>,
    pub resolver: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(
        mut,
        seeds = [
            Market::SEED_PREFIX,
            market.creator.as_ref(),
            &market.end_time.to_le_bytes(),
        ],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [
            Position::SEED_PREFIX,
            market.key().as_ref(),
            owner.key().as_ref(),
        ],
        bump,
        has_one = owner @ PredictionError::InvalidPositionOwner,
        has_one = market @ PredictionError::InvalidPositionMarket
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[account]
pub struct Market {
    pub id: u64,
    pub question: String,
    pub creator: Pubkey,
    pub resolver: Pubkey,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_liquidity: u64,
    pub end_time: i64,
    pub resolved: bool,
    pub outcome: u8,
}

impl Market {
    pub const SEED_PREFIX: &'static [u8] = b"market";
    pub const MAX_QUESTION_BYTES: usize = 280;
    pub const INIT_SPACE: usize =
        8 + 4 + Self::MAX_QUESTION_BYTES + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    pub fn derive_id(creator: &Pubkey, end_time: i64, question: &[u8]) -> u64 {
        let end_time_bytes = end_time.to_le_bytes();
        let hash = anchor_lang::solana_program::hash::hashv(&[
            creator.as_ref(),
            &end_time_bytes,
            question,
        ]);
        let bytes = hash.to_bytes();

        u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ])
    }
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
}

impl Position {
    pub const SEED_PREFIX: &'static [u8] = b"position";
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8;
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub id: u64,
    pub creator: Pubkey,
    pub resolver: Pubkey,
    pub question: String,
    pub end_time: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: u8,
    pub amount: u64,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_liquidity: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub resolver: Pubkey,
    pub outcome: u8,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_liquidity: u64,
}

#[error_code]
pub enum PredictionError {
    #[msg("Question cannot be empty.")]
    EmptyQuestion,
    #[msg("Question is too long.")]
    QuestionTooLong,
    #[msg("End time must be in the future.")]
    InvalidEndTime,
    #[msg("Bet amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Side must be 0 (NO) or 1 (YES).")]
    InvalidSide,
    #[msg("Market is closed.")]
    MarketClosed,
    #[msg("Market has already been resolved.")]
    MarketAlreadyResolved,
    #[msg("Only the market resolver can perform this action.")]
    UnauthorizedResolver,
    #[msg("Market has not reached its end time.")]
    MarketNotEnded,
    #[msg("Market has not been resolved.")]
    MarketNotResolved,
    #[msg("No liquidity exists on the winning side.")]
    EmptyWinningPool,
    #[msg("Position has no claimable winning shares.")]
    NoWinningPosition,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Insufficient market lamports.")]
    InsufficientMarketLamports,
    #[msg("Invalid position owner.")]
    InvalidPositionOwner,
    #[msg("Invalid position market.")]
    InvalidPositionMarket,
}
