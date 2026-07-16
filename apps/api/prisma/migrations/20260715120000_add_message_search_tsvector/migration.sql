-- Full-text search over Message.content using the "portuguese" text search
-- configuration. to_tsvector(regconfig, text) is STABLE, not IMMUTABLE, so
-- it cannot be used directly in an index expression or a generated column;
-- wrapping the fixed configuration in a SQL function marked IMMUTABLE is
-- Postgres's documented pattern for this
-- (https://www.postgresql.org/docs/current/textsearch-tables.html#TEXTSEARCH-TABLES-INDEX).
CREATE FUNCTION message_search_vector(content text) RETURNS tsvector AS $$
  SELECT to_tsvector('portuguese', content);
$$ LANGUAGE SQL IMMUTABLE;

-- CreateIndex
CREATE INDEX "Message_search_vector_idx" ON "Message" USING GIN (message_search_vector("content"));
