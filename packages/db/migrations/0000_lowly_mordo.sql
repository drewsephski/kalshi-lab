CREATE TYPE "public"."market_source" AS ENUM('kalshi_demo', 'kalshi_production_public');--> statement-breakpoint
CREATE TYPE "public"."worker_run_status" AS ENUM('running', 'completed', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"source" "market_source" NOT NULL,
	"worker_run_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"ticker_received_at" timestamp with time zone NOT NULL,
	"book_received_at" timestamp with time zone,
	"book_verified_at" timestamp with time zone,
	"exchange_timestamp" timestamp with time zone,
	"status" text NOT NULL,
	"transport" text NOT NULL,
	"connected" boolean NOT NULL,
	"stale" boolean NOT NULL,
	"yes_bid" numeric(8, 4),
	"yes_ask" numeric(8, 4),
	"no_bid" numeric(8, 4),
	"no_ask" numeric(8, 4),
	"last_price" numeric(8, 4),
	"yes_bid_size" numeric(24, 2),
	"yes_ask_size" numeric(24, 2),
	"no_bid_size" numeric(24, 2),
	"no_ask_size" numeric(24, 2),
	"volume" numeric(24, 2),
	"open_interest" numeric(24, 2),
	"supplemental" jsonb NOT NULL,
	CONSTRAINT "snapshots_binary_prices" CHECK (("market_snapshots"."yes_bid" BETWEEN 0 AND 1 OR "market_snapshots"."yes_bid" IS NULL) AND ("market_snapshots"."yes_ask" BETWEEN 0 AND 1 OR "market_snapshots"."yes_ask" IS NULL) AND ("market_snapshots"."no_bid" BETWEEN 0 AND 1 OR "market_snapshots"."no_bid" IS NULL) AND ("market_snapshots"."no_ask" BETWEEN 0 AND 1 OR "market_snapshots"."no_ask" IS NULL) AND ("market_snapshots"."last_price" BETWEEN 0 AND 1 OR "market_snapshots"."last_price" IS NULL)),
	CONSTRAINT "snapshots_nonnegative_counts" CHECK (coalesce("market_snapshots"."volume", 0) >= 0 AND coalesce("market_snapshots"."open_interest", 0) >= 0 AND coalesce("market_snapshots"."yes_bid_size", 0) >= 0 AND coalesce("market_snapshots"."yes_ask_size", 0) >= 0 AND coalesce("market_snapshots"."no_bid_size", 0) >= 0 AND coalesce("market_snapshots"."no_ask_size", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "market_source" NOT NULL,
	"ticker" text NOT NULL,
	"event_ticker" text,
	"title" text NOT NULL,
	"subtitle" text,
	"status" text NOT NULL,
	"open_time" timestamp with time zone,
	"close_time" timestamp with time zone,
	"expiration_time" timestamp with time zone,
	"metadata" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "markets_id_source_uq" UNIQUE("id","source")
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "market_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "worker_run_status" DEFAULT 'running' NOT NULL,
	"markets_tracked" integer DEFAULT 0 NOT NULL,
	"snapshots_written" bigint DEFAULT 0 NOT NULL,
	"last_successful_observation_at" timestamp with time zone,
	"error" text,
	"git_commit" text NOT NULL,
	"git_dirty" boolean NOT NULL,
	"recorder_version" text NOT NULL,
	"config" jsonb NOT NULL,
	"reconnect_count" integer DEFAULT 0 NOT NULL,
	"malformed_messages" integer DEFAULT 0 NOT NULL,
	"dropped_snapshots" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "worker_runs_id_source_uq" UNIQUE("id","source"),
	CONSTRAINT "worker_runs_nonnegative_counts" CHECK ("worker_runs"."markets_tracked" >= 0 AND "worker_runs"."snapshots_written" >= 0 AND "worker_runs"."dropped_snapshots" >= 0)
);
--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "snapshots_market_source_fk" FOREIGN KEY ("market_id","source") REFERENCES "public"."markets"("id","source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "snapshots_run_source_fk" FOREIGN KEY ("worker_run_id","source") REFERENCES "public"."worker_runs"("id","source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_run_market_observed_uq" ON "market_snapshots" USING btree ("worker_run_id","market_id","observed_at");--> statement-breakpoint
CREATE INDEX "snapshots_market_observed_idx" ON "market_snapshots" USING btree ("market_id","observed_at");--> statement-breakpoint
CREATE INDEX "snapshots_source_observed_idx" ON "market_snapshots" USING btree ("source","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_source_ticker_uq" ON "markets" USING btree ("source","ticker");--> statement-breakpoint
CREATE INDEX "markets_source_status_idx" ON "markets" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "markets_source_event_idx" ON "markets" USING btree ("source","event_ticker");--> statement-breakpoint
CREATE INDEX "worker_runs_source_started_idx" ON "worker_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "worker_runs_status_heartbeat_idx" ON "worker_runs" USING btree ("status","heartbeat_at");