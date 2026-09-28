ALTER TABLE "market_trades" DROP CONSTRAINT "trades_valid_direction";--> statement-breakpoint
UPDATE "market_trades" SET "aggressor_side" = CASE "aggressor_side"
  WHEN 'yes_buy' THEN 'yes_exposure'
  WHEN 'no_buy' THEN 'no_exposure'
  ELSE "aggressor_side" END
WHERE "aggressor_side" IN ('yes_buy', 'no_buy');--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "trades_valid_direction" CHECK ("market_trades"."aggressor_side" IN ('yes_exposure','no_exposure','unknown') AND "market_trades"."side_provenance" IN ('provider_explicit','unknown'));
