CREATE TABLE "fee_rule_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_ticker" text,
	"series_ticker" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"fee_type" text,
	"fee_multiplier" numeric(12, 4),
	"maker_multiplier" numeric(12, 4),
	"taker_multiplier" numeric(12, 4),
	"source_url" text NOT NULL,
	"source_type" text NOT NULL,
	"raw_metadata" jsonb NOT NULL,
	"collection_run_id" uuid NOT NULL,
	CONSTRAINT "fees_valid_window" CHECK ("fee_rule_snapshots"."effective_to" IS NULL OR "fee_rule_snapshots"."effective_from" IS NOT NULL AND "fee_rule_snapshots"."effective_to" > "fee_rule_snapshots"."effective_from"),
	CONSTRAINT "fees_valid_source" CHECK ("fee_rule_snapshots"."source_type" IN ('official_series_api','official_event_api','official_event_fee_change_api','official_fee_schedule','official_regulatory_notice','unknown'))
);
--> statement-breakpoint
CREATE TABLE "market_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "market_source" NOT NULL,
	"provider_trade_id" text NOT NULL,
	"market_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"event_ticker" text,
	"executed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"yes_price" numeric(8, 4) NOT NULL,
	"no_price" numeric(8, 4) NOT NULL,
	"quantity" numeric(24, 2) NOT NULL,
	"taker_outcome_side" text,
	"taker_book_side" text,
	"aggressor_side" text NOT NULL,
	"side_provenance" text NOT NULL,
	"is_block_trade" boolean NOT NULL,
	"raw_metadata" jsonb NOT NULL,
	"collection_run_id" uuid NOT NULL,
	CONSTRAINT "trades_valid_numbers" CHECK ("market_trades"."yes_price" >= 0 AND "market_trades"."yes_price" <= 1 AND "market_trades"."no_price" >= 0 AND "market_trades"."no_price" <= 1 AND "market_trades"."yes_price" + "market_trades"."no_price" = 1 AND "market_trades"."quantity" > 0),
	CONSTRAINT "trades_valid_direction" CHECK ("market_trades"."aggressor_side" IN ('yes_buy','no_buy','unknown') AND "market_trades"."side_provenance" IN ('provider_explicit','unknown'))
);
--> statement-breakpoint
CREATE TABLE "trade_collector_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"status" "worker_run_status" NOT NULL,
	"git_commit" text NOT NULL,
	"git_dirty" boolean NOT NULL,
	"config" jsonb NOT NULL,
	"trades_written" bigint DEFAULT 0 NOT NULL,
	"duplicates_seen" bigint DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "fee_rule_snapshots" ADD CONSTRAINT "fees_collection_run_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."trade_collector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "trades_market_source_fk" FOREIGN KEY ("market_id","source") REFERENCES "public"."markets"("id","source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "trades_collection_run_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."trade_collector_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fees_event_window_idx" ON "fee_rule_snapshots" USING btree ("event_ticker","effective_from");--> statement-breakpoint
CREATE INDEX "fees_series_observed_idx" ON "fee_rule_snapshots" USING btree ("series_ticker","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_source_provider_id_uq" ON "market_trades" USING btree ("source","provider_trade_id");--> statement-breakpoint
CREATE INDEX "trades_market_executed_idx" ON "market_trades" USING btree ("market_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_source_executed_idx" ON "market_trades" USING btree ("source","executed_at");