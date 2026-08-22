CREATE TABLE `import_evidence_routes` (
	`import_id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`route_version` integer NOT NULL,
	CONSTRAINT "import_evidence_routes_version_check" CHECK("route_version" = 1)
);
