import{n as t}from"./chunk-ChpBd9eV.js";import{st as E,t as n}from"./src-BmBNODK0.js";function r(e){return"harness_"+e.toLowerCase().replace(/-/g,"_")}async function _(e){const s=r(e),{sql:a}=E();await a.unsafe(`
    CREATE SCHEMA IF NOT EXISTS ${s};

    GRANT USAGE ON SCHEMA ${s} TO harness_app, harness_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO harness_app, harness_admin;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO harness_app, harness_admin;
  `);try{await a.unsafe(`
      GRANT USAGE ON SCHEMA ${s} TO harness_zero;
      GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO harness_zero;
    `)}catch{}await a.unsafe(`
    CREATE OR REPLACE VIEW ${s}.harness_features AS
      SELECT * FROM harness_shared.harness_features_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${s}.harness_issues AS
      SELECT * FROM harness_shared.harness_issues_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${s}.agent_runs AS
      SELECT * FROM harness_shared.agent_runs_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${s}.harness_snapshots AS
      SELECT * FROM harness_shared.harness_snapshots_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${s}.agent_chats AS
      SELECT * FROM harness_shared.agent_chats_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    -- Column defaults so writers that omit these on INSERT pass through.
    -- harness_slug satisfies WITH CHECK OPTION.
    --
    -- NO workspace_id DEFAULT here, deliberately (WI-5243 / the WI-5125 class).
    -- This block used to mirror migration 116's workspace_id SET DEFAULT
    -- 'default', which made every writer that omitted the column file its row
    -- under the WRONG tenant while the INSERT still reported success — 181
    -- unreadable agent_chats rows, surfacing as a chat panel that spun forever.
    -- The active workspace is only knowable IN-PROCESS, so a literal here is a
    -- guess. Writers stamp it explicitly (activeWorkspaceId()), and
    -- harness_shared.fill_workspace_id_from_projects() is the BEFORE INSERT
    -- derive-net. Migration 616 dropped these defaults from existing schemas;
    -- re-adding one here would silently reintroduce the bug for every NEW
    -- harness (which is exactly how this scaffolder cloned it in the first place).
    ALTER VIEW ${s}.agent_chats ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,"''")}';
    ALTER VIEW ${s}.agent_chats ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;
    ALTER VIEW ${s}.agent_chats ALTER COLUMN updated_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;
    ALTER VIEW ${s}.agent_chats ALTER COLUMN transcript SET DEFAULT '[]'::jsonb;
    ALTER VIEW ${s}.agent_chats ALTER COLUMN total_input_tokens SET DEFAULT 0;
    ALTER VIEW ${s}.agent_chats ALTER COLUMN total_output_tokens SET DEFAULT 0;
    ALTER VIEW ${s}.agent_chats ALTER COLUMN total_cost_usd_cents SET DEFAULT 0;

    CREATE OR REPLACE VIEW ${s}.supervisor_notes AS
      SELECT * FROM harness_shared.supervisor_notes_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    ALTER VIEW ${s}.supervisor_notes ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,"''")}';
    ALTER VIEW ${s}.supervisor_notes ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;
    ALTER VIEW ${s}.supervisor_notes ALTER COLUMN body SET DEFAULT '';
    ALTER VIEW ${s}.supervisor_notes ALTER COLUMN source SET DEFAULT '';

    CREATE OR REPLACE VIEW ${s}.directive_summaries AS
      SELECT * FROM harness_shared.directive_summaries_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    ALTER VIEW ${s}.directive_summaries ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,"''")}';
    ALTER VIEW ${s}.directive_summaries ALTER COLUMN source SET DEFAULT 'ceo';
    ALTER VIEW ${s}.directive_summaries ALTER COLUMN summary SET DEFAULT '';
    ALTER VIEW ${s}.directive_summaries ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;

    CREATE OR REPLACE VIEW ${s}.executed_actions AS
      SELECT * FROM harness_shared.executed_actions_consolidated
      WHERE harness_slug = '${e.replace(/'/g,"''")}'
      WITH CHECK OPTION;

    ALTER VIEW ${s}.executed_actions ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,"''")}';

    GRANT SELECT, INSERT, UPDATE, DELETE ON
      ${s}.harness_features,
      ${s}.harness_issues,
      ${s}.agent_runs,
      ${s}.harness_snapshots,
      ${s}.agent_chats,
      ${s}.supervisor_notes,
      ${s}.directive_summaries,
      ${s}.executed_actions
      TO harness_app, harness_admin;
  `);try{await a.unsafe(`
      GRANT SELECT ON
        ${s}.harness_features,
        ${s}.harness_issues,
        ${s}.agent_runs,
        ${s}.harness_snapshots,
        ${s}.agent_chats,
        ${s}.supervisor_notes,
        ${s}.directive_summaries,
        ${s}.executed_actions
        TO harness_zero;
    `)}catch{}}async function c(e){const{sql:s}=E();await s.unsafe(`DROP SCHEMA IF EXISTS ${r(e)} CASCADE`)}var h=t((()=>{n()}));export{_ as i,r as n,h as r,c as t};
