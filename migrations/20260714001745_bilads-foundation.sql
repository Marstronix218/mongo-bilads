-- Bilads single-workspace persistence foundation.
-- The application uses the server-only project-admin client. Browser/anonymous
-- database access is intentionally disabled; there are no end-user accounts.

CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.workspaces (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'bilads', 'Bilads');

CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  client_request_id UUID NOT NULL,
  sample_id TEXT CHECK (sample_id IS NULL OR char_length(sample_id) <= 120),
  product_name TEXT NOT NULL CHECK (char_length(btrim(product_name)) BETWEEN 1 AND 160),
  product_description TEXT NOT NULL DEFAULT '' CHECK (char_length(product_description) <= 12000),
  target_audience TEXT NOT NULL DEFAULT '' CHECK (char_length(target_audience) <= 4000),
  weekly_budget_usd NUMERIC(12, 2) NOT NULL CHECK (weekly_budget_usd > 0),
  campaign_weeks SMALLINT NOT NULL CHECK (campaign_weeks BETWEEN 1 AND 52),
  awareness_weight NUMERIC(4, 3) NOT NULL CHECK (awareness_weight BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'researched', 'designed', 'simulated', 'archived')),
  research_result JSONB CHECK (research_result IS NULL OR jsonb_typeof(research_result) = 'object'),
  opened_board_ids TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(opened_board_ids) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, client_request_id)
);

CREATE INDEX campaigns_workspace_status_updated_idx
  ON public.campaigns(workspace_id, status, updated_at DESC);

CREATE TABLE public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID,
  initiated_by_subject TEXT NOT NULL DEFAULT 'bilads-app'
    CHECK (char_length(initiated_by_subject) BETWEEN 1 AND 200),
  request_id TEXT NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  agent TEXT NOT NULL CHECK (char_length(btrim(agent)) BETWEEN 1 AND 120),
  model TEXT CHECK (model IS NULL OR char_length(model) <= 200),
  input_hash CHAR(64) CHECK (input_hash IS NULL OR input_hash ~ '^[0-9a-f]{64}$'),
  input_summary JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(input_summary) = 'object'),
  output_summary JSONB CHECK (output_summary IS NULL OR jsonb_typeof(output_summary) = 'object'),
  execution_mode TEXT NOT NULL DEFAULT 'live'
    CHECK (execution_mode IN ('live', 'fallback', 'cache', 'mixed')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  error_code TEXT CHECK (error_code IS NULL OR char_length(error_code) <= 120),
  error_detail TEXT CHECK (error_detail IS NULL OR char_length(error_detail) <= 2000),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES public.campaigns(id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, campaign_id, workspace_id)
);

CREATE UNIQUE INDEX agent_runs_campaign_request_agent_idx
  ON public.agent_runs(campaign_id, request_id, agent)
  WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX agent_runs_global_request_agent_idx
  ON public.agent_runs(workspace_id, request_id, agent)
  WHERE campaign_id IS NULL;
CREATE INDEX agent_runs_workspace_campaign_created_idx
  ON public.agent_runs(workspace_id, campaign_id, created_at DESC);

CREATE TABLE public.creative_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  agent_run_id UUID,
  created_by_subject TEXT NOT NULL DEFAULT 'bilads-app'
    CHECK (char_length(created_by_subject) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  billboard_id TEXT NOT NULL CHECK (char_length(billboard_id) BETWEEN 1 AND 160),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 1),
  concept_key TEXT NOT NULL CHECK (char_length(concept_key) BETWEEN 1 AND 120),
  consistent_brand BOOLEAN NOT NULL DEFAULT false,
  language TEXT NOT NULL CHECK (language IN ('en', 'es')),
  headline TEXT NOT NULL CHECK (char_length(btrim(headline)) BETWEEN 1 AND 200),
  subline TEXT NOT NULL DEFAULT '' CHECK (char_length(subline) <= 240),
  rationale TEXT NOT NULL DEFAULT '' CHECK (char_length(rationale) <= 1000),
  source TEXT NOT NULL CHECK (source IN ('live', 'fallback', 'cache', 'canned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES public.campaigns(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_run_id, campaign_id, workspace_id)
    REFERENCES public.agent_runs(id, campaign_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, campaign_id, workspace_id),
  UNIQUE (campaign_id, idempotency_key, position)
);

CREATE INDEX creative_variants_workspace_campaign_created_idx
  ON public.creative_variants(workspace_id, campaign_id, created_at DESC);

CREATE TABLE public.creative_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  creative_variant_id UUID,
  created_by_subject TEXT NOT NULL DEFAULT 'bilads-app'
    CHECK (char_length(created_by_subject) BETWEEN 1 AND 200),
  asset_kind TEXT NOT NULL
    CHECK (asset_kind IN ('product_source', 'generated_art', 'billboard_mockup')),
  bucket_name TEXT NOT NULL CHECK (char_length(bucket_name) BETWEEN 1 AND 120),
  object_key TEXT NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1000),
  storage_url TEXT NOT NULL CHECK (char_length(storage_url) BETWEEN 1 AND 2000),
  mime_type TEXT NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 160),
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 10485760),
  sha256 CHAR(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES public.campaigns(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (creative_variant_id, campaign_id, workspace_id)
    REFERENCES public.creative_variants(id, campaign_id, workspace_id) ON DELETE RESTRICT,
  CHECK (
    (asset_kind = 'product_source' AND creative_variant_id IS NULL)
    OR (asset_kind <> 'product_source' AND creative_variant_id IS NOT NULL)
  ),
  CHECK (object_key LIKE workspace_id::text || '/' || campaign_id::text || '/%'),
  UNIQUE (bucket_name, object_key)
);

CREATE INDEX creative_assets_workspace_campaign_idx
  ON public.creative_assets(workspace_id, campaign_id, created_at DESC);

CREATE TABLE public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  workspace_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  agent_run_id UUID NOT NULL,
  room_id TEXT NOT NULL CHECK (char_length(room_id) BETWEEN 1 AND 128),
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('agent', 'human', 'system')),
  agent_name TEXT CHECK (agent_name IS NULL OR char_length(agent_name) <= 120),
  role_label TEXT CHECK (role_label IS NULL OR char_length(role_label) <= 200),
  actor_subject TEXT CHECK (actor_subject IS NULL OR char_length(actor_subject) <= 200),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 12000),
  action TEXT CHECK (action IS NULL OR char_length(action) <= 120),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES public.campaigns(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_run_id, campaign_id, workspace_id)
    REFERENCES public.agent_runs(id, campaign_id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX agent_messages_campaign_room_seq_idx
  ON public.agent_messages(campaign_id, room_id, event_seq);
CREATE INDEX agent_messages_run_campaign_workspace_idx
  ON public.agent_messages(agent_run_id, campaign_id, workspace_id);

CREATE TABLE public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  workspace_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  room_id TEXT CHECK (room_id IS NULL OR char_length(room_id) <= 128),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'edited')),
  decided_by_subject TEXT NOT NULL CHECK (char_length(decided_by_subject) BETWEEN 1 AND 200),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 4000),
  context JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(context) = 'object'),
  request_id TEXT NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES public.campaigns(id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (campaign_id, request_id)
);

CREATE INDEX approvals_campaign_room_seq_idx
  ON public.approvals(campaign_id, room_id, event_seq);

CREATE TABLE public.outbound_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID,
  record_id TEXT NOT NULL CHECK (char_length(record_id) BETWEEN 1 AND 200),
  address TEXT NOT NULL CHECK (char_length(address) BETWEEN 1 AND 1000),
  advertiser_name TEXT NOT NULL CHECK (char_length(advertiser_name) BETWEEN 1 AND 300),
  category TEXT NOT NULL DEFAULT '' CHECK (char_length(category) <= 200),
  fit_score SMALLINT NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  visibility_score SMALLINT CHECK (visibility_score IS NULL OR visibility_score BETWEEN 0 AND 100),
  pitch_subject TEXT CHECK (pitch_subject IS NULL OR char_length(pitch_subject) <= 500),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'drafted', 'ready', 'sent', 'archived')),
  sent_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES public.campaigns(id, workspace_id) ON DELETE RESTRICT,
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (sent_at IS NULL OR status IN ('sent', 'archived')),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX outbound_queue_active_identity_idx
  ON public.outbound_queue_items(
    workspace_id,
    COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    record_id,
    lower(advertiser_name)
  ) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.workspace_id(p_slug TEXT DEFAULT 'bilads')
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT id FROM public.workspaces WHERE slug = p_slug
$$;

CREATE OR REPLACE FUNCTION public.create_campaign(
  p_workspace_slug TEXT,
  p_client_request_id UUID,
  p_product_name TEXT,
  p_product_description TEXT,
  p_target_audience TEXT,
  p_weekly_budget_usd NUMERIC,
  p_campaign_weeks SMALLINT,
  p_awareness_weight NUMERIC,
  p_sample_id TEXT DEFAULT NULL
)
RETURNS public.campaigns
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_workspace UUID := public.workspace_id(p_workspace_slug);
  v_campaign public.campaigns;
BEGIN
  IF v_workspace IS NULL THEN RAISE EXCEPTION 'workspace not found'; END IF;
  INSERT INTO public.campaigns (
    workspace_id, client_request_id, sample_id, product_name, product_description,
    target_audience, weekly_budget_usd, campaign_weeks, awareness_weight
  ) VALUES (
    v_workspace, p_client_request_id, NULLIF(btrim(p_sample_id), ''), btrim(p_product_name),
    COALESCE(p_product_description, ''), COALESCE(p_target_audience, ''),
    p_weekly_budget_usd, p_campaign_weeks, p_awareness_weight
  )
  ON CONFLICT (workspace_id, client_request_id) DO NOTHING
  RETURNING * INTO v_campaign;

  IF v_campaign.id IS NULL THEN
    SELECT * INTO v_campaign FROM public.campaigns
    WHERE workspace_id = v_workspace AND client_request_id = p_client_request_id;
    IF v_campaign.product_name IS DISTINCT FROM btrim(p_product_name)
      OR v_campaign.product_description IS DISTINCT FROM COALESCE(p_product_description, '')
      OR v_campaign.target_audience IS DISTINCT FROM COALESCE(p_target_audience, '')
      OR v_campaign.weekly_budget_usd IS DISTINCT FROM p_weekly_budget_usd
      OR v_campaign.campaign_weeks IS DISTINCT FROM p_campaign_weeks
      OR v_campaign.awareness_weight IS DISTINCT FROM p_awareness_weight
      OR v_campaign.sample_id IS DISTINCT FROM NULLIF(btrim(p_sample_id), '') THEN
      RAISE EXCEPTION 'client_request_id already belongs to different campaign data' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN v_campaign;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_campaign_research(
  p_workspace_slug TEXT,
  p_campaign_id UUID,
  p_research_result JSONB
)
RETURNS public.campaigns
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_workspace UUID := public.workspace_id(p_workspace_slug);
  v_campaign public.campaigns;
BEGIN
  IF p_research_result IS NULL
    OR jsonb_typeof(p_research_result) IS DISTINCT FROM 'object'
    OR octet_length(p_research_result::text) > 1048576 THEN
    RAISE EXCEPTION 'research_result must be an object no larger than 1 MiB';
  END IF;
  SELECT * INTO v_campaign FROM public.campaigns
  WHERE id = p_campaign_id AND workspace_id = v_workspace;
  IF v_campaign.id IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  IF v_campaign.status NOT IN ('draft', 'researched') THEN
    RAISE EXCEPTION 'research cannot be changed after creative work begins';
  END IF;
  UPDATE public.campaigns
  SET research_result = p_research_result,
      status = CASE WHEN status = 'draft' THEN 'researched' ELSE status END
  WHERE id = p_campaign_id AND workspace_id = v_workspace
  RETURNING * INTO v_campaign;
  RETURN v_campaign;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_product_asset(
  p_workspace_slug TEXT,
  p_campaign_id UUID,
  p_bucket_name TEXT,
  p_object_key TEXT,
  p_storage_url TEXT,
  p_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256 TEXT
)
RETURNS public.creative_assets
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_workspace UUID := public.workspace_id(p_workspace_slug);
  v_asset public.creative_assets;
BEGIN
  IF p_bucket_name IS DISTINCT FROM 'product-assets' THEN
    RAISE EXCEPTION 'product assets must use product-assets';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = p_campaign_id AND workspace_id = v_workspace) THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;
  INSERT INTO public.creative_assets (
    workspace_id, campaign_id, asset_kind, bucket_name, object_key,
    storage_url, mime_type, byte_size, sha256
  ) VALUES (
    v_workspace, p_campaign_id, 'product_source', p_bucket_name, p_object_key,
    p_storage_url, p_mime_type, p_byte_size, p_sha256
  )
  ON CONFLICT (bucket_name, object_key) DO NOTHING
  RETURNING * INTO v_asset;
  IF v_asset.id IS NULL THEN
    SELECT * INTO v_asset FROM public.creative_assets
    WHERE bucket_name = p_bucket_name AND object_key = p_object_key;
    IF v_asset.campaign_id IS DISTINCT FROM p_campaign_id
      OR v_asset.workspace_id IS DISTINCT FROM v_workspace
      OR v_asset.asset_kind IS DISTINCT FROM 'product_source'
      OR v_asset.storage_url IS DISTINCT FROM p_storage_url
      OR v_asset.mime_type IS DISTINCT FROM p_mime_type
      OR v_asset.byte_size IS DISTINCT FROM p_byte_size
      OR v_asset.sha256 IS DISTINCT FROM p_sha256 THEN
      RAISE EXCEPTION 'storage key already belongs to different content' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN v_asset;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_creative_generation(
  p_workspace_slug TEXT,
  p_campaign_id UUID,
  p_idempotency_key TEXT,
  p_billboard_id TEXT,
  p_generation INTEGER,
  p_consistent_brand BOOLEAN,
  p_source TEXT,
  p_concepts JSONB
)
RETURNS UUID[]
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_workspace UUID := public.workspace_id(p_workspace_slug);
  v_campaign public.campaigns;
  v_concept JSONB;
  v_asset JSONB;
  v_variant public.creative_variants;
  v_variant_id UUID;
  v_ids UUID[] := '{}';
  v_position SMALLINT;
  v_expected SMALLINT := 0;
BEGIN
  IF p_concepts IS NULL OR jsonb_typeof(p_concepts) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'concepts must be a JSON array';
  END IF;
  IF jsonb_array_length(p_concepts) NOT BETWEEN 1 AND 2
    OR octet_length(p_concepts::text) > 1048576 THEN
    RAISE EXCEPTION 'concepts must contain one or two items and fit within 1 MiB';
  END IF;
  SELECT * INTO v_campaign FROM public.campaigns
  WHERE id = p_campaign_id AND workspace_id = v_workspace;
  IF v_campaign.id IS NULL OR v_campaign.status NOT IN ('researched', 'designed') THEN
    RAISE EXCEPTION 'creative generation requires a researched, active campaign';
  END IF;

  FOR v_concept IN SELECT value FROM jsonb_array_elements(p_concepts)
  LOOP
    IF jsonb_typeof(v_concept) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'each concept must be an object';
    END IF;
    v_position := (v_concept->>'position')::SMALLINT;
    IF v_position IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'concept positions must be ordered from zero';
    END IF;
    v_variant := NULL;
    v_variant_id := NULL;
    INSERT INTO public.creative_variants (
      workspace_id, campaign_id, idempotency_key, billboard_id, generation,
      position, concept_key, consistent_brand, language, headline, subline,
      rationale, source
    ) VALUES (
      v_workspace, p_campaign_id, p_idempotency_key, p_billboard_id, p_generation,
      v_position, v_concept->>'id', p_consistent_brand, v_concept->>'language',
      v_concept->>'headline', COALESCE(v_concept->>'subline', ''),
      COALESCE(v_concept->>'rationale', ''), p_source
    )
    ON CONFLICT (campaign_id, idempotency_key, position) DO NOTHING
    RETURNING id INTO v_variant_id;
    IF v_variant_id IS NULL THEN
      SELECT * INTO v_variant FROM public.creative_variants
      WHERE campaign_id = p_campaign_id AND idempotency_key = p_idempotency_key
        AND position = v_position;
      v_variant_id := v_variant.id;
      IF v_variant.billboard_id IS DISTINCT FROM p_billboard_id
        OR v_variant.generation IS DISTINCT FROM p_generation
        OR v_variant.concept_key IS DISTINCT FROM (v_concept->>'id')
        OR v_variant.consistent_brand IS DISTINCT FROM p_consistent_brand
        OR v_variant.language IS DISTINCT FROM (v_concept->>'language')
        OR v_variant.headline IS DISTINCT FROM (v_concept->>'headline')
        OR v_variant.subline IS DISTINCT FROM COALESCE(v_concept->>'subline', '')
        OR v_variant.rationale IS DISTINCT FROM COALESCE(v_concept->>'rationale', '')
        OR v_variant.source IS DISTINCT FROM p_source THEN
        RAISE EXCEPTION 'idempotency key already belongs to different creative data' USING ERRCODE = '23505';
      END IF;
    END IF;
    v_ids := array_append(v_ids, v_variant_id);
    v_asset := v_concept->'asset';
    IF jsonb_typeof(v_asset) = 'object' AND NULLIF(v_asset->>'key', '') IS NOT NULL THEN
      IF v_asset->>'bucket' IS DISTINCT FROM 'generated-creatives' THEN
        RAISE EXCEPTION 'generated assets must use generated-creatives';
      END IF;
      INSERT INTO public.creative_assets (
        workspace_id, campaign_id, creative_variant_id, asset_kind, bucket_name,
        object_key, storage_url, mime_type, byte_size, sha256
      ) VALUES (
        v_workspace, p_campaign_id, v_variant_id, 'generated_art', v_asset->>'bucket',
        v_asset->>'key', v_asset->>'url',
        COALESCE(NULLIF(v_asset->>'mimeType', ''), 'image/png'),
        CASE WHEN NULLIF(v_asset->>'byteSize', '') IS NULL THEN NULL ELSE (v_asset->>'byteSize')::BIGINT END,
        NULLIF(v_asset->>'sha256', '')
      ) ON CONFLICT (bucket_name, object_key) DO NOTHING;
    END IF;
    v_expected := v_expected + 1;
  END LOOP;
  UPDATE public.campaigns
  SET status = CASE WHEN status = 'researched' THEN 'designed' ELSE status END
  WHERE id = p_campaign_id AND workspace_id = v_workspace;
  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_approval(
  p_workspace_slug TEXT,
  p_campaign_id UUID,
  p_room_id TEXT,
  p_decision TEXT,
  p_decided_by_subject TEXT,
  p_note TEXT,
  p_context JSONB,
  p_request_id TEXT
)
RETURNS public.approvals
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_workspace UUID := public.workspace_id(p_workspace_slug);
  v_status TEXT;
  v_approval public.approvals;
BEGIN
  SELECT status INTO v_status FROM public.campaigns
  WHERE id = p_campaign_id AND workspace_id = v_workspace;
  IF v_status IS NULL OR v_status NOT IN ('researched', 'designed', 'simulated') THEN
    RAISE EXCEPTION 'approval requires a researched, active campaign';
  END IF;
  INSERT INTO public.approvals (
    workspace_id, campaign_id, room_id, decision, decided_by_subject,
    note, context, request_id
  ) VALUES (
    v_workspace, p_campaign_id, NULLIF(p_room_id, ''), p_decision,
    p_decided_by_subject, NULLIF(p_note, ''), COALESCE(p_context, '{}'::jsonb), p_request_id
  ) ON CONFLICT (campaign_id, request_id) DO NOTHING
  RETURNING * INTO v_approval;
  IF v_approval.id IS NULL THEN
    SELECT * INTO v_approval FROM public.approvals
    WHERE campaign_id = p_campaign_id AND request_id = p_request_id;
    IF v_approval.room_id IS DISTINCT FROM NULLIF(p_room_id, '')
      OR v_approval.decision IS DISTINCT FROM p_decision
      OR v_approval.decided_by_subject IS DISTINCT FROM p_decided_by_subject
      OR v_approval.note IS DISTINCT FROM NULLIF(p_note, '')
      OR v_approval.context IS DISTINCT FROM COALESCE(p_context, '{}'::jsonb) THEN
      RAISE EXCEPTION 'request_id already belongs to a different approval' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_campaign_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
    RAISE EXCEPTION 'campaign identity fields are immutable';
  END IF;
  IF OLD.status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'archived campaigns are immutable';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.product_name IS DISTINCT FROM OLD.product_name
    OR NEW.product_description IS DISTINCT FROM OLD.product_description
    OR NEW.target_audience IS DISTINCT FROM OLD.target_audience
    OR NEW.weekly_budget_usd IS DISTINCT FROM OLD.weekly_budget_usd
    OR NEW.campaign_weeks IS DISTINCT FROM OLD.campaign_weeks
    OR NEW.awareness_weight IS DISTINCT FROM OLD.awareness_weight
  ) THEN RAISE EXCEPTION 'campaign inputs are immutable after research'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'researched')
    OR (OLD.status = 'researched' AND NEW.status = 'designed')
    OR (OLD.status = 'designed' AND NEW.status = 'simulated')
    OR (OLD.status <> 'archived' AND NEW.status = 'archived')
  ) THEN RAISE EXCEPTION 'illegal campaign status transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaigns_guard_update BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_update();

CREATE OR REPLACE FUNCTION public.guard_agent_run()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.campaigns WHERE id = NEW.campaign_id AND workspace_id = NEW.workspace_id
  ) THEN RAISE EXCEPTION 'campaign not found in workspace'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
      OR NEW.initiated_by_subject IS DISTINCT FROM OLD.initiated_by_subject
      OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.agent IS DISTINCT FROM OLD.agent
      OR NEW.model IS DISTINCT FROM OLD.model OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
      OR NEW.input_summary IS DISTINCT FROM OLD.input_summary THEN
      RAISE EXCEPTION 'agent run identity/input fields are immutable';
    END IF;
    IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'terminal agent runs are immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'cancelled'))
      OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'cancelled'))
    ) THEN RAISE EXCEPTION 'illegal agent run status transition'; END IF;
  END IF;
  IF NEW.status = 'queued' AND (NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL) THEN
    RAISE EXCEPTION 'queued run cannot have timestamps';
  ELSIF NEW.status = 'running' AND (NEW.started_at IS NULL OR NEW.finished_at IS NOT NULL) THEN
    RAISE EXCEPTION 'running run requires started_at only';
  ELSIF NEW.status IN ('succeeded', 'failed', 'cancelled') AND (
    NEW.started_at IS NULL OR NEW.finished_at IS NULL OR NEW.finished_at < NEW.started_at
  ) THEN RAISE EXCEPTION 'terminal run requires valid timestamps'; END IF;
  IF NEW.status = 'succeeded' AND (NEW.error_code IS NOT NULL OR NEW.error_detail IS NOT NULL) THEN
    RAISE EXCEPTION 'succeeded run cannot have an error';
  ELSIF NEW.status = 'failed' AND NEW.error_code IS NULL THEN
    RAISE EXCEPTION 'failed run requires error_code';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_runs_guard BEFORE INSERT OR UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_run();

CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER creative_variants_append_only BEFORE UPDATE OR DELETE ON public.creative_variants
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER creative_assets_append_only BEFORE UPDATE OR DELETE ON public.creative_assets
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER agent_messages_append_only BEFORE UPDATE OR DELETE ON public.agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER agent_runs_updated_at BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER outbound_queue_items_updated_at BEFORE UPDATE ON public.outbound_queue_items
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_queue_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.workspaces, public.campaigns, public.agent_runs, public.creative_variants,
  public.creative_assets, public.agent_messages, public.approvals, public.outbound_queue_items
FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.workspace_id(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_campaign(TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC, SMALLINT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_campaign_research(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_product_asset(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_creative_generation(TEXT, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_approval(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_campaign_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_agent_run() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_append_only_mutation() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.workspace_id(TEXT) TO project_admin;
GRANT EXECUTE ON FUNCTION public.create_campaign(TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC, SMALLINT, NUMERIC, TEXT) TO project_admin;
GRANT EXECUTE ON FUNCTION public.set_campaign_research(TEXT, UUID, JSONB) TO project_admin;
GRANT EXECUTE ON FUNCTION public.record_product_asset(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO project_admin;
GRANT EXECUTE ON FUNCTION public.save_creative_generation(TEXT, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, JSONB) TO project_admin;
GRANT EXECUTE ON FUNCTION public.record_approval(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO project_admin;
