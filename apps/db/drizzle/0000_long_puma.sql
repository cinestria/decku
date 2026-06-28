CREATE TABLE IF NOT EXISTS "namespaces" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"label" text
);
