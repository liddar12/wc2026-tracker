-- DRAFT — review, then apply to prod (vodjwymxquuertmhtvuw) via SQL editor.
--
-- Score-column integrity: stored group_predictions.score / group_brackets.score
-- is what the Everyone-pool leaderboard RPC ranks by, but RLS lets any
-- authenticated user UPDATE every column of their own row, and the lock
-- triggers (20260605010000) deliberately exempt score-only updates AT ANY TIME
-- so the server scorer can run. Net effect pre-fix: a hand-crafted PostgREST
-- PATCH could set score=180 and lead the global leaderboard.
--
-- Fix: BEFORE INSERT/UPDATE triggers that make the score column writable only
-- by the service role (the Netlify score-brackets function). For ordinary
-- authenticated/anon writers the submitted score is silently DISCARDED
-- (INSERT → 0, UPDATE → previous value) rather than rejected, so the existing
-- client (which still sends a self-computed score on submit) keeps working
-- unchanged — its score value just stops mattering. The hourly scorer remains
-- the single source of truth.
--
-- Side effect (accepted): a fresh submission shows score 0 on the Everyone
-- leaderboard until the next hourly scorer run. Normal pools are unaffected
-- (they recompute client-side from picks).

create or replace function public.protect_score_column()
returns trigger
language plpgsql
security definer
as $$
declare
  jwt_claims text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role  text;
begin
  -- No JWT claims → direct SQL (migrations, dashboard, pg cron): privileged.
  if jwt_claims is null then
    return new;
  end if;
  jwt_role := coalesce(jwt_claims::json->>'role', '');
  if jwt_role = 'service_role' then
    return new;  -- the Netlify scorer: full write access to score
  end if;
  -- Ordinary writer: score is server-owned — discard whatever they sent.
  if tg_op = 'INSERT' then
    new.score := 0;
  else
    new.score := old.score;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_score_group_predictions on public.group_predictions;
create trigger trg_protect_score_group_predictions
  before insert or update on public.group_predictions
  for each row execute function public.protect_score_column();

drop trigger if exists trg_protect_score_group_brackets on public.group_brackets;
create trigger trg_protect_score_group_brackets
  before insert or update on public.group_brackets
  for each row execute function public.protect_score_column();
