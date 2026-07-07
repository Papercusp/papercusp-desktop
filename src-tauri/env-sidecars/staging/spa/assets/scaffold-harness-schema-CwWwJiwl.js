import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";function r(e){return`harness_`+e.toLowerCase().replace(/-/g,`_`)}async function i(e){let n=r(e),{sql:i}=t();await i.unsafe(`
    CREATE SCHEMA IF NOT EXISTS ${n};

    GRANT USAGE ON SCHEMA ${n} TO harness_app, harness_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${n} TO harness_app, harness_admin;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${n} TO harness_app, harness_admin;
  `);try{await i.unsafe(`
      GRANT USAGE ON SCHEMA ${n} TO harness_zero;
      GRANT SELECT ON ALL TABLES IN SCHEMA ${n} TO harness_zero;
    `)}catch{}await i.unsafe(`
    CREATE OR REPLACE VIEW ${n}.harness_features AS
      SELECT * FROM harness_shared.harness_features_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${n}.harness_issues AS
      SELECT * FROM harness_shared.harness_issues_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${n}.agent_runs AS
      SELECT * FROM harness_shared.agent_runs_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${n}.harness_snapshots AS
      SELECT * FROM harness_shared.harness_snapshots_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    CREATE OR REPLACE VIEW ${n}.agent_chats AS
      SELECT * FROM harness_shared.agent_chats_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    -- Column defaults so writers that omit these on INSERT pass through
    -- (matches migration 116). harness_slug satisfies WITH CHECK OPTION.
    ALTER VIEW ${n}.agent_chats ALTER COLUMN workspace_id SET DEFAULT 'default';
    ALTER VIEW ${n}.agent_chats ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,`''`)}';
    ALTER VIEW ${n}.agent_chats ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;
    ALTER VIEW ${n}.agent_chats ALTER COLUMN updated_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;
    ALTER VIEW ${n}.agent_chats ALTER COLUMN transcript SET DEFAULT '[]'::jsonb;
    ALTER VIEW ${n}.agent_chats ALTER COLUMN total_input_tokens SET DEFAULT 0;
    ALTER VIEW ${n}.agent_chats ALTER COLUMN total_output_tokens SET DEFAULT 0;
    ALTER VIEW ${n}.agent_chats ALTER COLUMN total_cost_usd_cents SET DEFAULT 0;

    CREATE OR REPLACE VIEW ${n}.supervisor_notes AS
      SELECT * FROM harness_shared.supervisor_notes_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    ALTER VIEW ${n}.supervisor_notes ALTER COLUMN workspace_id SET DEFAULT 'default';
    ALTER VIEW ${n}.supervisor_notes ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,`''`)}';
    ALTER VIEW ${n}.supervisor_notes ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;
    ALTER VIEW ${n}.supervisor_notes ALTER COLUMN body SET DEFAULT '';
    ALTER VIEW ${n}.supervisor_notes ALTER COLUMN source SET DEFAULT '';

    CREATE OR REPLACE VIEW ${n}.directive_summaries AS
      SELECT * FROM harness_shared.directive_summaries_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    ALTER VIEW ${n}.directive_summaries ALTER COLUMN workspace_id SET DEFAULT 'default';
    ALTER VIEW ${n}.directive_summaries ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,`''`)}';
    ALTER VIEW ${n}.directive_summaries ALTER COLUMN source SET DEFAULT 'ceo';
    ALTER VIEW ${n}.directive_summaries ALTER COLUMN summary SET DEFAULT '';
    ALTER VIEW ${n}.directive_summaries ALTER COLUMN created_at SET DEFAULT (extract(epoch FROM now()) * 1000)::bigint;

    CREATE OR REPLACE VIEW ${n}.messages AS
      SELECT * FROM harness_shared.messages_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    ALTER VIEW ${n}.messages ALTER COLUMN workspace_id SET DEFAULT 'default';
    ALTER VIEW ${n}.messages ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,`''`)}';

    CREATE OR REPLACE VIEW ${n}.executed_actions AS
      SELECT * FROM harness_shared.executed_actions_consolidated
      WHERE harness_slug = '${e.replace(/'/g,`''`)}'
      WITH CHECK OPTION;

    ALTER VIEW ${n}.executed_actions ALTER COLUMN workspace_id SET DEFAULT 'default';
    ALTER VIEW ${n}.executed_actions ALTER COLUMN harness_slug SET DEFAULT '${e.replace(/'/g,`''`)}';

    GRANT SELECT, INSERT, UPDATE, DELETE ON
      ${n}.harness_features,
      ${n}.harness_issues,
      ${n}.agent_runs,
      ${n}.harness_snapshots,
      ${n}.agent_chats,
      ${n}.supervisor_notes,
      ${n}.directive_summaries,
      ${n}.messages,
      ${n}.executed_actions
      TO harness_app, harness_admin;
  `);try{await i.unsafe(`
      GRANT SELECT ON
        ${n}.harness_features,
        ${n}.harness_issues,
        ${n}.agent_runs,
        ${n}.harness_snapshots,
        ${n}.agent_chats,
        ${n}.supervisor_notes,
        ${n}.directive_summaries,
        ${n}.messages,
        ${n}.executed_actions
        TO harness_zero;
    `)}catch{}}async function a(e){let{sql:n}=t();await n.unsafe(`DROP SCHEMA IF EXISTS ${r(e)} CASCADE`)}var o=e((()=>{n()}));export{i,r as n,o as r,a as t};