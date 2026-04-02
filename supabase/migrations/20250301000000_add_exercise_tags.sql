-- Add tags array column to exercises for filtering and organization
-- Original: migration-003-exercise-tags.sql

alter table exercises add column tags text[] not null default '{}';

-- GIN index for efficient tag filtering
create index idx_exercises_tags on exercises using gin(tags);
