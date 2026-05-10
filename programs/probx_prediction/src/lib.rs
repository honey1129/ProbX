use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("4xwQsrqnu5beRquRWeccSLHzBeGQ1SjZgMJ4LS4KvYL");

pub const SIDE_NO: u8 = 0;
pub const SIDE_YES: u8 = 1;
pub const OUTCOME_CANCELLED: u8 = 2;
pub const PRICE_SCALE: u64 = 1_000_000_000;

#[program]
pub mod probx_prediction {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        end_time: i64,
        initial_liquidity: u64,
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
        require!(
            initial_liquidity > 0,
            PredictionError::InvalidInitialLiquidity
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            initial_liquidity,
        )?;

        let creator = ctx.accounts.creator.key();
        let market = &mut ctx.accounts.market;

        market.id = Market::derive_id(&creator, end_time, question.as_bytes());
        market.question = question.clone();
        market.creator = creator;
        market.resolver = creator;
        market.yes_pool = initial_liquidity;
        market.no_pool = initial_liquidity;
        market.total_liquidity = initial_liquidity;
        market.yes_shares = 0;
        market.no_shares = 0;
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
            initial_liquidity,
            yes_pool: market.yes_pool,
            no_pool: market.no_pool,
        });

        Ok(())
    }

    /// Backwards-compatible name for older clients. Prefer buy_shares.
    pub fn place_bet(ctx: Context<BuyShares>, amount: u64, side: u8) -> Result<()> {
        buy_shares_impl(ctx, amount, side, 0)
    }

    pub fn buy_shares(
        ctx: Context<BuyShares>,
        amount: u64,
        side: u8,
        min_shares_out: u64,
    ) -> Result<()> {
        buy_shares_impl(ctx, amount, side, min_shares_out)
    }

    pub fn sell_shares(
        ctx: Context<SellShares>,
        shares: u64,
        side: u8,
        min_lamports_out: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(shares > 0, PredictionError::InvalidAmount);
        require_valid_side(side)?;
        require!(
            !ctx.accounts.market.resolved,
            PredictionError::MarketAlreadyResolved
        );
        require!(
            clock.unix_timestamp < ctx.accounts.market.end_time,
            PredictionError::MarketClosed
        );

        let quote = ctx.accounts.market.quote_sell(shares, side)?;
        require!(
            quote.lamports_out >= min_lamports_out,
            PredictionError::SlippageExceeded
        );

        {
            let position = &mut ctx.accounts.position;
            if side == SIDE_YES {
                require!(
                    position.yes_amount >= shares,
                    PredictionError::InsufficientShares
                );
                position.yes_amount = position
                    .yes_amount
                    .checked_sub(shares)
                    .ok_or(PredictionError::MathOverflow)?;
            } else {
                require!(
                    position.no_amount >= shares,
                    PredictionError::InsufficientShares
                );
                position.no_amount = position
                    .no_amount
                    .checked_sub(shares)
                    .ok_or(PredictionError::MathOverflow)?;
            }
        }

        {
            let market = &mut ctx.accounts.market;
            require!(
                market.total_liquidity >= quote.lamports_out,
                PredictionError::InsufficientMarketLamports
            );
            market.yes_pool = quote.next_yes_pool;
            market.no_pool = quote.next_no_pool;
            market.total_liquidity = market
                .total_liquidity
                .checked_sub(quote.lamports_out)
                .ok_or(PredictionError::MathOverflow)?;
            if side == SIDE_YES {
                market.yes_shares = market
                    .yes_shares
                    .checked_sub(shares)
                    .ok_or(PredictionError::MathOverflow)?;
            } else {
                market.no_shares = market
                    .no_shares
                    .checked_sub(shares)
                    .ok_or(PredictionError::MathOverflow)?;
            }
        }

        transfer_from_market(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            quote.lamports_out,
        )?;

        emit!(SharesSold {
            market: ctx.accounts.market.key(),
            owner: ctx.accounts.owner.key(),
            side,
            shares,
            lamports_out: quote.lamports_out,
            yes_pool: quote.next_yes_pool,
            no_pool: quote.next_no_pool,
            total_liquidity: ctx.accounts.market.total_liquidity,
            price_after: ctx.accounts.market.yes_price()?,
        });

        Ok(())
    }

    /// Returns YES probability as fixed point scaled by PRICE_SCALE.
    /// For example, 0.25 is returned as 250_000_000.
    pub fn get_price(ctx: Context<GetPrice>) -> Result<u64> {
        ctx.accounts.market.yes_price()
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: u8) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require_valid_side(outcome)?;
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
            yes_shares: market.yes_shares,
            no_shares: market.no_shares,
        });

        Ok(())
    }

    pub fn set_resolver(ctx: Context<SetResolver>, new_resolver: Pubkey) -> Result<()> {
        require!(
            new_resolver != Pubkey::default(),
            PredictionError::InvalidResolver
        );

        let market = &mut ctx.accounts.market;
        let previous_resolver = market.resolver;
        market.resolver = new_resolver;

        emit!(MarketResolverUpdated {
            market: market.key(),
            previous_resolver,
            new_resolver,
        });

        Ok(())
    }

    pub fn cancel_market(ctx: Context<CancelMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, PredictionError::MarketAlreadyResolved);

        market.outcome = OUTCOME_CANCELLED;
        market.resolved = true;

        emit!(MarketCancelled {
            market: market.key(),
            resolver: ctx.accounts.resolver.key(),
            yes_pool: market.yes_pool,
            no_pool: market.no_pool,
            total_liquidity: market.total_liquidity,
            yes_shares: market.yes_shares,
            no_shares: market.no_shares,
        });

        Ok(())
    }

    /// Backwards-compatible name for older clients. Prefer redeem_winnings.
    pub fn claim_reward(ctx: Context<RedeemWinnings>) -> Result<()> {
        redeem_winnings_impl(ctx)
    }

    pub fn redeem_winnings(ctx: Context<RedeemWinnings>) -> Result<()> {
        redeem_winnings_impl(ctx)
    }

    pub fn refund_cancelled(ctx: Context<RefundCancelled>) -> Result<()> {
        let payout = {
            let market = &mut ctx.accounts.market;
            let position = &mut ctx.accounts.position;

            require!(market.resolved, PredictionError::MarketNotResolved);
            require!(
                market.outcome == OUTCOME_CANCELLED,
                PredictionError::MarketNotCancelled
            );

            let refundable = position
                .yes_amount
                .checked_add(position.no_amount)
                .ok_or(PredictionError::MathOverflow)?;
            require!(refundable > 0, PredictionError::NoRefundablePosition);
            require!(
                market.total_liquidity >= refundable,
                PredictionError::InsufficientMarketLamports
            );

            if position.yes_amount > 0 {
                market.yes_shares = market
                    .yes_shares
                    .checked_sub(position.yes_amount)
                    .ok_or(PredictionError::MathOverflow)?;
            }
            if position.no_amount > 0 {
                market.no_shares = market
                    .no_shares
                    .checked_sub(position.no_amount)
                    .ok_or(PredictionError::MathOverflow)?;
            }

            position.yes_amount = 0;
            position.no_amount = 0;
            market.total_liquidity = market
                .total_liquidity
                .checked_sub(refundable)
                .ok_or(PredictionError::MathOverflow)?;

            refundable
        };

        transfer_from_market(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            payout,
        )?;

        emit!(RefundRedeemed {
            market: ctx.accounts.market.key(),
            owner: ctx.accounts.owner.key(),
            payout,
            total_liquidity: ctx.accounts.market.total_liquidity,
        });

        Ok(())
    }
}

fn buy_shares_impl(
    ctx: Context<BuyShares>,
    amount: u64,
    side: u8,
    min_shares_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(amount > 0, PredictionError::InvalidAmount);
    require_valid_side(side)?;
    require!(
        !ctx.accounts.market.resolved,
        PredictionError::MarketAlreadyResolved
    );
    require!(
        clock.unix_timestamp < ctx.accounts.market.end_time,
        PredictionError::MarketClosed
    );

    let quote = ctx.accounts.market.quote_buy(amount, side)?;
    require!(
        quote.shares_out >= min_shares_out,
        PredictionError::SlippageExceeded
    );

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.market.to_account_info(),
            },
        ),
        amount,
    )?;

    {
        let position = &mut ctx.accounts.position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.owner.key();
            position.market = ctx.accounts.market.key();
        }

        if side == SIDE_YES {
            position.yes_amount = position
                .yes_amount
                .checked_add(quote.shares_out)
                .ok_or(PredictionError::MathOverflow)?;
        } else {
            position.no_amount = position
                .no_amount
                .checked_add(quote.shares_out)
                .ok_or(PredictionError::MathOverflow)?;
        }
    }

    {
        let market = &mut ctx.accounts.market;
        market.yes_pool = quote.next_yes_pool;
        market.no_pool = quote.next_no_pool;
        market.total_liquidity = market
            .total_liquidity
            .checked_add(amount)
            .ok_or(PredictionError::MathOverflow)?;
        if side == SIDE_YES {
            market.yes_shares = market
                .yes_shares
                .checked_add(quote.shares_out)
                .ok_or(PredictionError::MathOverflow)?;
        } else {
            market.no_shares = market
                .no_shares
                .checked_add(quote.shares_out)
                .ok_or(PredictionError::MathOverflow)?;
        }
    }

    emit!(SharesBought {
        market: ctx.accounts.market.key(),
        owner: ctx.accounts.owner.key(),
        side,
        amount,
        shares_out: quote.shares_out,
        yes_pool: quote.next_yes_pool,
        no_pool: quote.next_no_pool,
        total_liquidity: ctx.accounts.market.total_liquidity,
        price_after: ctx.accounts.market.yes_price()?,
    });

    emit!(BetPlaced {
        market: ctx.accounts.market.key(),
        bettor: ctx.accounts.owner.key(),
        side,
        amount,
        yes_pool: quote.next_yes_pool,
        no_pool: quote.next_no_pool,
        total_liquidity: ctx.accounts.market.total_liquidity,
    });

    Ok(())
}

fn redeem_winnings_impl(ctx: Context<RedeemWinnings>) -> Result<()> {
    require!(
        ctx.accounts.market.resolved,
        PredictionError::MarketNotResolved
    );
    require!(
        ctx.accounts.market.outcome != OUTCOME_CANCELLED,
        PredictionError::MarketCancelled
    );

    let payout = {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        let winning_shares = if market.outcome == SIDE_YES {
            position.yes_amount
        } else {
            position.no_amount
        };
        require!(winning_shares > 0, PredictionError::NoWinningPosition);
        require!(
            market.total_liquidity >= winning_shares,
            PredictionError::InsufficientMarketLamports
        );

        if position.yes_amount > 0 {
            market.yes_shares = market
                .yes_shares
                .checked_sub(position.yes_amount)
                .ok_or(PredictionError::MathOverflow)?;
        }
        if position.no_amount > 0 {
            market.no_shares = market
                .no_shares
                .checked_sub(position.no_amount)
                .ok_or(PredictionError::MathOverflow)?;
        }

        position.yes_amount = 0;
        position.no_amount = 0;
        market.total_liquidity = market
            .total_liquidity
            .checked_sub(winning_shares)
            .ok_or(PredictionError::MathOverflow)?;

        winning_shares
    };

    transfer_from_market(
        &ctx.accounts.market.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        payout,
    )?;

    emit!(WinningsRedeemed {
        market: ctx.accounts.market.key(),
        owner: ctx.accounts.owner.key(),
        outcome: ctx.accounts.market.outcome,
        payout,
        total_liquidity: ctx.accounts.market.total_liquidity,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(question: String, end_time: i64, initial_liquidity: u64)]
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
pub struct BuyShares<'info> {
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
pub struct SellShares<'info> {
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
pub struct SetResolver<'info> {
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
pub struct CancelMarket<'info> {
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
pub struct RedeemWinnings<'info> {
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

#[derive(Accounts)]
pub struct RefundCancelled<'info> {
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
    /// YES-side AMM price weight. Higher value means a higher YES probability.
    pub yes_pool: u64,
    /// NO-side AMM price weight. Higher value means a higher NO probability.
    pub no_pool: u64,
    /// Native SOL collateral held by the market, excluding account rent.
    pub total_liquidity: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub end_time: i64,
    pub resolved: bool,
    pub outcome: u8,
}

impl Market {
    pub const SEED_PREFIX: &'static [u8] = b"market";
    pub const MAX_QUESTION_BYTES: usize = 280;
    pub const INIT_SPACE: usize =
        8 + 4 + Self::MAX_QUESTION_BYTES + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
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

    pub fn yes_price(&self) -> Result<u64> {
        let total = (self.yes_pool as u128)
            .checked_add(self.no_pool as u128)
            .ok_or(PredictionError::MathOverflow)?;
        if total == 0 {
            return Ok(0);
        }

        let price = (self.yes_pool as u128)
            .checked_mul(PRICE_SCALE as u128)
            .ok_or(PredictionError::MathOverflow)?
            .checked_div(total)
            .ok_or(PredictionError::MathOverflow)?;

        u64::try_from(price).map_err(|_| PredictionError::MathOverflow.into())
    }

    fn quote_buy(&self, amount: u64, side: u8) -> Result<BuyQuote> {
        let yes_pool = self.yes_pool as u128;
        let no_pool = self.no_pool as u128;
        require!(
            yes_pool > 0 && no_pool > 0,
            PredictionError::InsufficientLiquidity
        );

        let invariant = yes_pool
            .checked_mul(no_pool)
            .ok_or(PredictionError::MathOverflow)?;

        if side == SIDE_YES {
            let next_yes_pool = yes_pool
                .checked_add(amount as u128)
                .ok_or(PredictionError::MathOverflow)?;
            let next_no_pool = ceil_div(invariant, next_yes_pool)?;
            require!(next_no_pool < no_pool, PredictionError::AmountTooSmall);
            let shares_out = no_pool
                .checked_sub(next_no_pool)
                .ok_or(PredictionError::MathOverflow)?;
            BuyQuote::new(shares_out, next_yes_pool, next_no_pool)
        } else {
            let next_no_pool = no_pool
                .checked_add(amount as u128)
                .ok_or(PredictionError::MathOverflow)?;
            let next_yes_pool = ceil_div(invariant, next_no_pool)?;
            require!(next_yes_pool < yes_pool, PredictionError::AmountTooSmall);
            let shares_out = yes_pool
                .checked_sub(next_yes_pool)
                .ok_or(PredictionError::MathOverflow)?;
            BuyQuote::new(shares_out, next_yes_pool, next_no_pool)
        }
    }

    fn quote_sell(&self, shares: u64, side: u8) -> Result<SellQuote> {
        let yes_pool = self.yes_pool as u128;
        let no_pool = self.no_pool as u128;
        require!(
            yes_pool > 0 && no_pool > 0,
            PredictionError::InsufficientLiquidity
        );

        let invariant = yes_pool
            .checked_mul(no_pool)
            .ok_or(PredictionError::MathOverflow)?;

        if side == SIDE_YES {
            let next_no_pool = no_pool
                .checked_add(shares as u128)
                .ok_or(PredictionError::MathOverflow)?;
            let next_yes_pool = ceil_div(invariant, next_no_pool)?;
            require!(next_yes_pool < yes_pool, PredictionError::AmountTooSmall);
            let lamports_out = yes_pool
                .checked_sub(next_yes_pool)
                .ok_or(PredictionError::MathOverflow)?;
            SellQuote::new(lamports_out, next_yes_pool, next_no_pool)
        } else {
            let next_yes_pool = yes_pool
                .checked_add(shares as u128)
                .ok_or(PredictionError::MathOverflow)?;
            let next_no_pool = ceil_div(invariant, next_yes_pool)?;
            require!(next_no_pool < no_pool, PredictionError::AmountTooSmall);
            let lamports_out = no_pool
                .checked_sub(next_no_pool)
                .ok_or(PredictionError::MathOverflow)?;
            SellQuote::new(lamports_out, next_yes_pool, next_no_pool)
        }
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

struct BuyQuote {
    shares_out: u64,
    next_yes_pool: u64,
    next_no_pool: u64,
}

impl BuyQuote {
    fn new(shares_out: u128, next_yes_pool: u128, next_no_pool: u128) -> Result<Self> {
        Ok(Self {
            shares_out: u64::try_from(shares_out).map_err(|_| PredictionError::MathOverflow)?,
            next_yes_pool: u64::try_from(next_yes_pool)
                .map_err(|_| PredictionError::MathOverflow)?,
            next_no_pool: u64::try_from(next_no_pool).map_err(|_| PredictionError::MathOverflow)?,
        })
    }
}

struct SellQuote {
    lamports_out: u64,
    next_yes_pool: u64,
    next_no_pool: u64,
}

impl SellQuote {
    fn new(lamports_out: u128, next_yes_pool: u128, next_no_pool: u128) -> Result<Self> {
        Ok(Self {
            lamports_out: u64::try_from(lamports_out).map_err(|_| PredictionError::MathOverflow)?,
            next_yes_pool: u64::try_from(next_yes_pool)
                .map_err(|_| PredictionError::MathOverflow)?,
            next_no_pool: u64::try_from(next_no_pool).map_err(|_| PredictionError::MathOverflow)?,
        })
    }
}

fn ceil_div(numerator: u128, denominator: u128) -> Result<u128> {
    require!(denominator > 0, PredictionError::MathOverflow);
    let adjusted = numerator
        .checked_add(
            denominator
                .checked_sub(1)
                .ok_or(PredictionError::MathOverflow)?,
        )
        .ok_or(PredictionError::MathOverflow)?;
    Ok(adjusted / denominator)
}

fn require_valid_side(side: u8) -> Result<()> {
    require!(
        side == SIDE_NO || side == SIDE_YES,
        PredictionError::InvalidSide
    );
    Ok(())
}

fn transfer_from_market<'info>(
    market_info: &AccountInfo<'info>,
    owner_info: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let rent_exempt_min = Rent::get()?.minimum_balance(Market::SPACE);
    let market_lamports = market_info.lamports();
    let available = market_lamports
        .checked_sub(rent_exempt_min)
        .ok_or(PredictionError::InsufficientMarketLamports)?;
    require!(
        available >= amount,
        PredictionError::InsufficientMarketLamports
    );

    **market_info.try_borrow_mut_lamports()? = market_lamports
        .checked_sub(amount)
        .ok_or(PredictionError::MathOverflow)?;
    **owner_info.try_borrow_mut_lamports()? = owner_info
        .lamports()
        .checked_add(amount)
        .ok_or(PredictionError::MathOverflow)?;

    Ok(())
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub id: u64,
    pub creator: Pubkey,
    pub resolver: Pubkey,
    pub question: String,
    pub end_time: i64,
    pub initial_liquidity: u64,
    pub yes_pool: u64,
    pub no_pool: u64,
}

#[event]
pub struct SharesBought {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub side: u8,
    pub amount: u64,
    pub shares_out: u64,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_liquidity: u64,
    pub price_after: u64,
}

#[event]
pub struct SharesSold {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub side: u8,
    pub shares: u64,
    pub lamports_out: u64,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_liquidity: u64,
    pub price_after: u64,
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
    pub yes_shares: u64,
    pub no_shares: u64,
}

#[event]
pub struct MarketResolverUpdated {
    pub market: Pubkey,
    pub previous_resolver: Pubkey,
    pub new_resolver: Pubkey,
}

#[event]
pub struct MarketCancelled {
    pub market: Pubkey,
    pub resolver: Pubkey,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_liquidity: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
}

#[event]
pub struct WinningsRedeemed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub outcome: u8,
    pub payout: u64,
    pub total_liquidity: u64,
}

#[event]
pub struct RefundRedeemed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub payout: u64,
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
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Side must be 0 (NO) or 1 (YES).")]
    InvalidSide,
    #[msg("Market is closed.")]
    MarketClosed,
    #[msg("Market has already been resolved.")]
    MarketAlreadyResolved,
    #[msg("Only the market resolver can perform this action.")]
    UnauthorizedResolver,
    #[msg("Resolver public key is invalid.")]
    InvalidResolver,
    #[msg("Market has not reached its end time.")]
    MarketNotEnded,
    #[msg("Market has not been resolved.")]
    MarketNotResolved,
    #[msg("Market was cancelled and must be refunded.")]
    MarketCancelled,
    #[msg("Market is not cancelled.")]
    MarketNotCancelled,
    #[msg("Initial liquidity must be greater than zero.")]
    InvalidInitialLiquidity,
    #[msg("Position has no claimable winning shares.")]
    NoWinningPosition,
    #[msg("Position has no refundable shares.")]
    NoRefundablePosition,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Insufficient market lamports.")]
    InsufficientMarketLamports,
    #[msg("Invalid position owner.")]
    InvalidPositionOwner,
    #[msg("Invalid position market.")]
    InvalidPositionMarket,
    #[msg("Trade output is below the requested slippage limit.")]
    SlippageExceeded,
    #[msg("Position does not have enough shares.")]
    InsufficientShares,
    #[msg("AMM pool has insufficient liquidity.")]
    InsufficientLiquidity,
    #[msg("Amount is too small for the AMM pool.")]
    AmountTooSmall,
}
