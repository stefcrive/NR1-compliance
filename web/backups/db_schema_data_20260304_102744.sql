


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."question_dimension" AS ENUM (
    'severity',
    'probability'
);


ALTER TYPE "public"."question_dimension" OWNER TO "postgres";


CREATE TYPE "public"."scoring_rule" AS ENUM (
    'direct',
    'inverted'
);


ALTER TYPE "public"."scoring_rule" OWNER TO "postgres";


CREATE TYPE "public"."survey_status" AS ENUM (
    'draft',
    'live',
    'closed',
    'archived'
);


ALTER TYPE "public"."survey_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_sector_submission"("p_sector_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update survey_sectors
  set
    submission_count = submission_count + 1,
    last_submitted_at = now(),
    updated_at = now()
  where id = p_sector_id;
$$;


ALTER FUNCTION "public"."bump_sector_submission"("p_sector_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("p_survey_id" "uuid", "p_ip_hash" "text", "p_now" timestamp with time zone DEFAULT "now"(), "p_burst_limit" integer DEFAULT 5, "p_hour_limit" integer DEFAULT 30) RETURNS TABLE("allowed" boolean, "minute_hits" integer, "hour_hits" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_minute_bucket timestamptz := date_trunc('minute', p_now);
begin
  insert into rate_limit_buckets (survey_id, ip_hash, window_start, hit_count)
  values (p_survey_id, p_ip_hash, v_minute_bucket, 1)
  on conflict (survey_id, ip_hash, window_start)
  do update set hit_count = rate_limit_buckets.hit_count + 1;

  select rlb.hit_count
    into minute_hits
  from rate_limit_buckets rlb
  where rlb.survey_id = p_survey_id
    and rlb.ip_hash = p_ip_hash
    and rlb.window_start = v_minute_bucket;

  select coalesce(sum(rlb.hit_count), 0)::int
    into hour_hits
  from rate_limit_buckets rlb
  where rlb.survey_id = p_survey_id
    and rlb.ip_hash = p_ip_hash
    and rlb.window_start >= (p_now - interval '1 hour');

  allowed := minute_hits <= p_burst_limit and hour_hits <= p_hour_limit;
  return next;
end;
$$;


ALTER FUNCTION "public"."check_rate_limit"("p_survey_id" "uuid", "p_ip_hash" "text", "p_now" timestamp with time zone, "p_burst_limit" integer, "p_hour_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_campaign_stats"() RETURNS TABLE("id" "uuid", "name" "text", "public_slug" "text", "status" "public"."survey_status", "starts_at" timestamp with time zone, "closes_at" timestamp with time zone, "k_anonymity_min" smallint, "question_count" integer, "response_count" integer, "latest_response_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    AS $$
with q as (
  select survey_id, count(*)::int as question_count
  from questions
  where is_active = true
  group by survey_id
),
r as (
  select survey_id, count(*)::int as response_count, max(submitted_at) as latest_response_at
  from responses
  group by survey_id
)
select
  s.id,
  s.name,
  s.public_slug,
  s.status,
  s.starts_at,
  s.closes_at,
  s.k_anonymity_min,
  coalesce(q.question_count, 0) as question_count,
  coalesce(r.response_count, 0) as response_count,
  r.latest_response_at,
  s.created_at
from surveys s
left join q on q.survey_id = s.id
left join r on r.survey_id = s.id
order by s.created_at desc;
$$;


ALTER FUNCTION "public"."get_campaign_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_group_counts"("p_survey_id" "uuid", "p_group_key" "text") RETURNS TABLE("group_value" "text", "n_responses" integer)
    LANGUAGE "sql" STABLE
    AS $$
select
  r.group_values ->> p_group_key as group_value,
  count(*)::int as n_responses
from responses r
where r.survey_id = p_survey_id
  and coalesce(r.group_values ->> p_group_key, '') <> ''
group by r.group_values ->> p_group_key
order by n_responses desc, group_value asc;
$$;


ALTER FUNCTION "public"."get_group_counts"("p_survey_id" "uuid", "p_group_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_response_timeseries"("p_survey_id" "uuid", "p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "response_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
with days as (
  select generate_series(
    current_date - make_interval(days => greatest(p_days, 1) - 1),
    current_date,
    interval '1 day'
  )::date as day
),
r as (
  select date_trunc('day', submitted_at)::date as day, count(*)::int as response_count
  from responses
  where survey_id = p_survey_id
    and submitted_at >= current_date - make_interval(days => greatest(p_days, 1))
  group by 1
)
select d.day, coalesce(r.response_count, 0)::int as response_count
from days d
left join r on r.day = d.day
order by d.day asc;
$$;


ALTER FUNCTION "public"."get_response_timeseries"("p_survey_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_topic_aggregates"("p_survey_id" "uuid", "p_group_key" "text" DEFAULT NULL::"text", "p_group_value" "text" DEFAULT NULL::"text") RETURNS TABLE("topic_id" smallint, "n_responses" integer, "mean_severity" numeric, "mean_probability" numeric)
    LANGUAGE "sql" STABLE
    AS $$
with filtered_responses as (
  select r.id
  from responses r
  where r.survey_id = p_survey_id
    and (
      p_group_key is null
      or (
        p_group_value is not null
        and r.group_values ? p_group_key
        and r.group_values ->> p_group_key = p_group_value
      )
    )
),
response_count as (
  select count(*)::int as n
  from filtered_responses
),
topic_dim as (
  select
    q.topic_id,
    q.dimension,
    avg(a.corrected_value)::numeric(10,4) as mean_value
  from answers a
  join questions q on q.id = a.question_id
  where q.survey_id = p_survey_id
    and a.response_id in (select id from filtered_responses)
  group by q.topic_id, q.dimension
),
topics_in_survey as (
  select distinct q.topic_id
  from questions q
  where q.survey_id = p_survey_id
)
select
  tis.topic_id,
  rc.n as n_responses,
  max(case when td.dimension = 'severity' then td.mean_value end) as mean_severity,
  max(case when td.dimension = 'probability' then td.mean_value end) as mean_probability
from topics_in_survey tis
cross join response_count rc
left join topic_dim td on td.topic_id = tis.topic_id
group by tis.topic_id, rc.n
order by tis.topic_id;
$$;


ALTER FUNCTION "public"."get_topic_aggregates"("p_survey_id" "uuid", "p_group_key" "text", "p_group_value" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."answers" (
    "response_id" "uuid" NOT NULL,
    "question_id" "uuid" NOT NULL,
    "raw_value" numeric(8,4) NOT NULL,
    "corrected_value" numeric(8,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "event_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "source_client_program_id" "uuid",
    "event_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calendar_events_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "calendar_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['continuous_meeting'::"text", 'blocked'::"text"]))),
    CONSTRAINT "calendar_events_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_program_availability_requests" (
    "request_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "client_program_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "due_at" timestamp with time zone,
    "suggested_slots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "selected_slots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "submitted_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_program_availability_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'submitted'::"text", 'scheduled'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."client_program_availability_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_programs" (
    "client_program_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "program_id" "uuid" NOT NULL,
    "status" character varying(50) NOT NULL,
    "deployed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "schedule_frequency_override" "text",
    "schedule_anchor_date_override" "date",
    CONSTRAINT "client_programs_schedule_frequency_override_check" CHECK ((("schedule_frequency_override" IS NULL) OR ("schedule_frequency_override" = ANY (ARRAY['weekly'::"text", 'biweekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'semiannual'::"text", 'annual'::"text", 'custom'::"text"])))),
    CONSTRAINT "client_programs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Recommended'::character varying, 'Active'::character varying, 'Completed'::character varying])::"text"[])))
);


ALTER TABLE "public"."client_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "survey_id" "uuid",
    "report_title" "text" NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "generated_by" "text" DEFAULT 'manager'::"text" NOT NULL,
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_reports_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'processing'::"text", 'ready'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_sectors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "remote_workers" integer DEFAULT 0 NOT NULL,
    "onsite_workers" integer DEFAULT 0 NOT NULL,
    "hybrid_workers" integer DEFAULT 0 NOT NULL,
    "risk_parameter" numeric(8,4) DEFAULT 1.0000 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "functions" "text",
    "workers_in_role" integer DEFAULT 0 NOT NULL,
    "possible_mental_health_harms" "text",
    "existing_control_measures" "text",
    "elaboration_date" "date",
    "shifts" "text",
    "vulnerable_groups" "text",
    "main_contact_name" "text",
    "main_contact_email" "text",
    "main_contact_phone" "text",
    CONSTRAINT "client_sectors_hybrid_workers_check" CHECK (("hybrid_workers" >= 0)),
    CONSTRAINT "client_sectors_onsite_workers_check" CHECK (("onsite_workers" >= 0)),
    CONSTRAINT "client_sectors_remote_workers_check" CHECK (("remote_workers" >= 0)),
    CONSTRAINT "client_sectors_risk_parameter_check" CHECK ((("risk_parameter" >= 0.5000) AND ("risk_parameter" <= 2.0000))),
    CONSTRAINT "client_sectors_workers_in_role_non_negative" CHECK (("workers_in_role" >= 0))
);


ALTER TABLE "public"."client_sectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "client_id" "uuid" NOT NULL,
    "company_name" character varying(255) NOT NULL,
    "cnpj" character varying(18) NOT NULL,
    "total_employees" integer NOT NULL,
    "status" character varying(50) NOT NULL,
    "portal_slug" "text",
    "contact_name" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "remote_employees" integer DEFAULT 0 NOT NULL,
    "onsite_employees" integer DEFAULT 0 NOT NULL,
    "hybrid_employees" integer DEFAULT 0 NOT NULL,
    "billing_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "contract_start_date" "date",
    "contract_end_date" "date",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "absenteeism_rate" numeric(5,2),
    "turnover_rate" numeric(5,2),
    "mental_health_leave_cases" integer,
    "organizational_climate_reports" "text",
    CONSTRAINT "clients_absenteeism_rate_range" CHECK ((("absenteeism_rate" IS NULL) OR (("absenteeism_rate" >= (0)::numeric) AND ("absenteeism_rate" <= (100)::numeric)))),
    CONSTRAINT "clients_billing_status_check" CHECK (("billing_status" = ANY (ARRAY['up_to_date'::"text", 'pending'::"text", 'overdue'::"text", 'blocked'::"text"]))),
    CONSTRAINT "clients_headcount_non_negative" CHECK ((("remote_employees" >= 0) AND ("onsite_employees" >= 0) AND ("hybrid_employees" >= 0))),
    CONSTRAINT "clients_headcount_total_check" CHECK (((("remote_employees" + "onsite_employees") + "hybrid_employees") <= "total_employees")),
    CONSTRAINT "clients_mental_health_leave_cases_non_negative" CHECK ((("mental_health_leave_cases" IS NULL) OR ("mental_health_leave_cases" >= 0))),
    CONSTRAINT "clients_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Active'::character varying, 'Pending'::character varying, 'Inactive'::character varying])::"text"[]))),
    CONSTRAINT "clients_total_employees_check" CHECK (("total_employees" >= 1)),
    CONSTRAINT "clients_turnover_rate_range" CHECK ((("turnover_rate" IS NULL) OR (("turnover_rate" >= (0)::numeric) AND ("turnover_rate" <= (100)::numeric))))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drps_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "survey_id" "uuid" NOT NULL,
    "sector" "text" NOT NULL,
    "psychologist_name" "text" NOT NULL,
    "psychologist_crp" "text",
    "company_name" "text" NOT NULL,
    "company_cnpj" "text",
    "reference_period" "text" NOT NULL,
    "part1_answers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "part1_dimension_scores" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "part1_probability_score" numeric(8,4) NOT NULL,
    "part1_probability_class" "text" NOT NULL,
    "critical_topics" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "recommended_programs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "governance_actions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."drps_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drps_campaigns" (
    "campaign_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "campaign_name" character varying(255) NOT NULL,
    "status" character varying(50) NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "unique_link_token" character varying(255) NOT NULL,
    CONSTRAINT "drps_campaigns_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Draft'::character varying, 'Active'::character varying, 'Completed'::character varying])::"text"[])))
);


ALTER TABLE "public"."drps_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_responses" (
    "response_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "department" character varying(100) NOT NULL,
    "topic_id" integer NOT NULL,
    "calculated_risk_score" numeric(5,2) NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_responses_calculated_risk_score_check" CHECK ((("calculated_risk_score" >= 1.0) AND ("calculated_risk_score" <= 3.0))),
    CONSTRAINT "employee_responses_topic_id_check" CHECK ((("topic_id" >= 1) AND ("topic_id" <= 13)))
);


ALTER TABLE "public"."employee_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "invoice_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" character varying(50) NOT NULL,
    "due_date" "date" NOT NULL,
    CONSTRAINT "invoices_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "invoices_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Paid'::character varying, 'Pending'::character varying, 'Overdue'::character varying])::"text"[])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manager_notifications" (
    "notification_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "notification_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "manager_notifications_notification_type_check" CHECK (("notification_type" = ANY (ARRAY['client_reschedule_submitted'::"text", 'client_report_downloaded'::"text"])))
);


ALTER TABLE "public"."manager_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."periodic_programs" (
    "program_id" "uuid" NOT NULL,
    "title" character varying(255) NOT NULL,
    "description" "text",
    "target_risk_topic" integer NOT NULL,
    "trigger_threshold" numeric(5,2) NOT NULL,
    "schedule_frequency" character varying(24) DEFAULT 'monthly'::character varying NOT NULL,
    "schedule_anchor_date" "date",
    "evaluation_questions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "materials" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metrics" "jsonb" DEFAULT '{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}'::"jsonb" NOT NULL,
    CONSTRAINT "periodic_programs_schedule_frequency_chk" CHECK ((("schedule_frequency")::"text" = ANY ((ARRAY['weekly'::character varying, 'biweekly'::character varying, 'monthly'::character varying, 'quarterly'::character varying, 'semiannual'::character varying, 'annual'::character varying, 'custom'::character varying])::"text"[]))),
    CONSTRAINT "periodic_programs_target_risk_topic_check" CHECK ((("target_risk_topic" >= 1) AND ("target_risk_topic" <= 13))),
    CONSTRAINT "periodic_programs_trigger_threshold_check" CHECK ((("trigger_threshold" >= 1.0) AND ("trigger_threshold" <= 3.0)))
);


ALTER TABLE "public"."periodic_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "survey_id" "uuid" NOT NULL,
    "topic_id" smallint NOT NULL,
    "question_code" "text" NOT NULL,
    "position" integer NOT NULL,
    "prompt" "text" NOT NULL,
    "dimension" "public"."question_dimension" NOT NULL,
    "scoring_rule" "public"."scoring_rule" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "source_excel_col" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limit_buckets" (
    "survey_id" "uuid" NOT NULL,
    "ip_hash" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "hit_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rate_limit_buckets_ip_hash_check" CHECK (("length"("ip_hash") = 64))
);


ALTER TABLE "public"."rate_limit_buckets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "survey_id" "uuid" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_sid" "uuid",
    "ip_hash" "text",
    "group_values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "answers_json" "jsonb" NOT NULL,
    "sector_id" "uuid",
    CONSTRAINT "responses_answers_json_check" CHECK (("jsonb_typeof"("answers_json") = 'array'::"text")),
    CONSTRAINT "responses_group_values_check" CHECK (("jsonb_typeof"("group_values") = 'object'::"text")),
    CONSTRAINT "responses_ip_hash_check" CHECK ((("ip_hash" IS NULL) OR ("length"("ip_hash") = 64)))
);


ALTER TABLE "public"."responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_group_dimensions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "survey_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_required" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."survey_group_dimensions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_group_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dimension_id" "uuid" NOT NULL,
    "value" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."survey_group_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_sectors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "survey_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "risk_parameter" numeric(8,4) DEFAULT 1.0000 NOT NULL,
    "access_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(18), 'hex'::"text") NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "submission_count" integer DEFAULT 0 NOT NULL,
    "last_submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "survey_sectors_risk_parameter_check" CHECK ((("risk_parameter" >= 0.5000) AND ("risk_parameter" <= 2.0000))),
    CONSTRAINT "survey_sectors_submission_count_check" CHECK (("submission_count" >= 0))
);


ALTER TABLE "public"."survey_sectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."surveys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "public_slug" "text" NOT NULL,
    "status" "public"."survey_status" DEFAULT 'draft'::"public"."survey_status" NOT NULL,
    "likert_min" smallint DEFAULT 1 NOT NULL,
    "likert_max" smallint DEFAULT 5 NOT NULL,
    "k_anonymity_min" smallint DEFAULT 5 NOT NULL,
    "session_ttl_minutes" smallint DEFAULT 30 NOT NULL,
    "turnstile_site_key" "text" NOT NULL,
    "turnstile_expected_hostname" "text" NOT NULL,
    "starts_at" timestamp with time zone,
    "closes_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_id" "uuid",
    CONSTRAINT "surveys_k_anonymity_min_check" CHECK (("k_anonymity_min" >= 3)),
    CONSTRAINT "surveys_session_ttl_minutes_check" CHECK ((("session_ttl_minutes" >= 15) AND ("session_ttl_minutes" <= 60)))
);


ALTER TABLE "public"."surveys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."topics" (
    "id" smallint NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    CONSTRAINT "topics_id_check" CHECK ((("id" >= 1) AND ("id" <= 13)))
);


ALTER TABLE "public"."topics" OWNER TO "postgres";


ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_pkey" PRIMARY KEY ("response_id", "question_id");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."client_program_availability_requests"
    ADD CONSTRAINT "client_program_availability_requests_client_program_id_key" UNIQUE ("client_program_id");



ALTER TABLE ONLY "public"."client_program_availability_requests"
    ADD CONSTRAINT "client_program_availability_requests_pkey" PRIMARY KEY ("request_id");



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_pkey" PRIMARY KEY ("client_program_id");



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_sectors"
    ADD CONSTRAINT "client_sectors_client_id_key_key" UNIQUE ("client_id", "key");



ALTER TABLE ONLY "public"."client_sectors"
    ADD CONSTRAINT "client_sectors_client_id_name_key" UNIQUE ("client_id", "name");



ALTER TABLE ONLY "public"."client_sectors"
    ADD CONSTRAINT "client_sectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_cnpj_key" UNIQUE ("cnpj");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."drps_assessments"
    ADD CONSTRAINT "drps_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drps_campaigns"
    ADD CONSTRAINT "drps_campaigns_pkey" PRIMARY KEY ("campaign_id");



ALTER TABLE ONLY "public"."drps_campaigns"
    ADD CONSTRAINT "drps_campaigns_unique_link_token_key" UNIQUE ("unique_link_token");



ALTER TABLE ONLY "public"."employee_responses"
    ADD CONSTRAINT "employee_responses_pkey" PRIMARY KEY ("response_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_id");



ALTER TABLE ONLY "public"."manager_notifications"
    ADD CONSTRAINT "manager_notifications_pkey" PRIMARY KEY ("notification_id");



ALTER TABLE ONLY "public"."periodic_programs"
    ADD CONSTRAINT "periodic_programs_pkey" PRIMARY KEY ("program_id");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_survey_id_position_key" UNIQUE ("survey_id", "position");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_survey_id_question_code_key" UNIQUE ("survey_id", "question_code");



ALTER TABLE ONLY "public"."rate_limit_buckets"
    ADD CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("survey_id", "ip_hash", "window_start");



ALTER TABLE ONLY "public"."responses"
    ADD CONSTRAINT "responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_group_dimensions"
    ADD CONSTRAINT "survey_group_dimensions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_group_dimensions"
    ADD CONSTRAINT "survey_group_dimensions_survey_id_key_key" UNIQUE ("survey_id", "key");



ALTER TABLE ONLY "public"."survey_group_options"
    ADD CONSTRAINT "survey_group_options_dimension_id_value_key" UNIQUE ("dimension_id", "value");



ALTER TABLE ONLY "public"."survey_group_options"
    ADD CONSTRAINT "survey_group_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_sectors"
    ADD CONSTRAINT "survey_sectors_access_token_key" UNIQUE ("access_token");



ALTER TABLE ONLY "public"."survey_sectors"
    ADD CONSTRAINT "survey_sectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_sectors"
    ADD CONSTRAINT "survey_sectors_survey_id_key_key" UNIQUE ("survey_id", "key");



ALTER TABLE ONLY "public"."survey_sectors"
    ADD CONSTRAINT "survey_sectors_survey_id_name_key" UNIQUE ("survey_id", "name");



ALTER TABLE ONLY "public"."surveys"
    ADD CONSTRAINT "surveys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."surveys"
    ADD CONSTRAINT "surveys_public_slug_key" UNIQUE ("public_slug");



ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_pkey" PRIMARY KEY ("id");



CREATE INDEX "answers_question_idx" ON "public"."answers" USING "btree" ("question_id");



CREATE INDEX "calendar_events_client_idx" ON "public"."calendar_events" USING "btree" ("client_id", "starts_at");



CREATE INDEX "calendar_events_source_program_idx" ON "public"."calendar_events" USING "btree" ("source_client_program_id", "starts_at");



CREATE INDEX "client_program_availability_requests_client_idx" ON "public"."client_program_availability_requests" USING "btree" ("client_id", "status", "requested_at" DESC);



CREATE INDEX "client_programs_client_idx" ON "public"."client_programs" USING "btree" ("client_id", "status");



CREATE INDEX "client_reports_client_idx" ON "public"."client_reports" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_reports_survey_idx" ON "public"."client_reports" USING "btree" ("survey_id", "created_at" DESC);



CREATE INDEX "client_sectors_client_idx" ON "public"."client_sectors" USING "btree" ("client_id", "created_at");



CREATE UNIQUE INDEX "clients_portal_slug_idx" ON "public"."clients" USING "btree" ("portal_slug");



CREATE INDEX "drps_assessments_sector_idx" ON "public"."drps_assessments" USING "btree" ("survey_id", "sector");



CREATE INDEX "drps_assessments_survey_created_idx" ON "public"."drps_assessments" USING "btree" ("survey_id", "created_at" DESC);



CREATE INDEX "drps_campaigns_client_idx" ON "public"."drps_campaigns" USING "btree" ("client_id", "status");



CREATE INDEX "drps_campaigns_token_idx" ON "public"."drps_campaigns" USING "btree" ("unique_link_token");



CREATE INDEX "employee_responses_campaign_idx" ON "public"."employee_responses" USING "btree" ("campaign_id", "department");



CREATE INDEX "employee_responses_topic_idx" ON "public"."employee_responses" USING "btree" ("campaign_id", "topic_id");



CREATE INDEX "invoices_client_idx" ON "public"."invoices" USING "btree" ("client_id", "due_date" DESC);



CREATE INDEX "manager_notifications_client_idx" ON "public"."manager_notifications" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "manager_notifications_created_idx" ON "public"."manager_notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "manager_notifications_read_idx" ON "public"."manager_notifications" USING "btree" ("is_read", "created_at" DESC);



CREATE INDEX "questions_survey_position_idx" ON "public"."questions" USING "btree" ("survey_id", "position");



CREATE INDEX "questions_survey_topic_dim_idx" ON "public"."questions" USING "btree" ("survey_id", "topic_id", "dimension");



CREATE INDEX "rate_limit_lookup_idx" ON "public"."rate_limit_buckets" USING "btree" ("survey_id", "ip_hash", "window_start" DESC);



CREATE INDEX "responses_group_values_gin_idx" ON "public"."responses" USING "gin" ("group_values");



CREATE INDEX "responses_survey_sector_idx" ON "public"."responses" USING "btree" ("survey_id", "sector_id");



CREATE INDEX "responses_survey_sid_idx" ON "public"."responses" USING "btree" ("survey_id", "session_sid");



CREATE INDEX "responses_survey_submitted_idx" ON "public"."responses" USING "btree" ("survey_id", "submitted_at" DESC);



CREATE INDEX "survey_sectors_survey_idx" ON "public"."survey_sectors" USING "btree" ("survey_id", "is_active");



CREATE INDEX "survey_sectors_token_idx" ON "public"."survey_sectors" USING "btree" ("access_token");



CREATE INDEX "surveys_client_idx" ON "public"."surveys" USING "btree" ("client_id", "status", "created_at" DESC);



CREATE INDEX "surveys_slug_status_idx" ON "public"."surveys" USING "btree" ("public_slug", "status");



ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_source_client_program_id_fkey" FOREIGN KEY ("source_client_program_id") REFERENCES "public"."client_programs"("client_program_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_availability_requests"
    ADD CONSTRAINT "client_program_availability_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_availability_requests"
    ADD CONSTRAINT "client_program_availability_requests_client_program_id_fkey" FOREIGN KEY ("client_program_id") REFERENCES "public"."client_programs"("client_program_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."periodic_programs"("program_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_reports"
    ADD CONSTRAINT "client_reports_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_sectors"
    ADD CONSTRAINT "client_sectors_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drps_assessments"
    ADD CONSTRAINT "drps_assessments_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drps_campaigns"
    ADD CONSTRAINT "drps_campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_responses"
    ADD CONSTRAINT "employee_responses_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."drps_campaigns"("campaign_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manager_notifications"
    ADD CONSTRAINT "manager_notifications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id");



ALTER TABLE ONLY "public"."rate_limit_buckets"
    ADD CONSTRAINT "rate_limit_buckets_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."responses"
    ADD CONSTRAINT "responses_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "public"."survey_sectors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."responses"
    ADD CONSTRAINT "responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_group_dimensions"
    ADD CONSTRAINT "survey_group_dimensions_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_group_options"
    ADD CONSTRAINT "survey_group_options_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "public"."survey_group_dimensions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_sectors"
    ADD CONSTRAINT "survey_sectors_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."surveys"
    ADD CONSTRAINT "surveys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE SET NULL;





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."bump_sector_submission"("p_sector_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."bump_sector_submission"("p_sector_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_sector_submission"("p_sector_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_survey_id" "uuid", "p_ip_hash" "text", "p_now" timestamp with time zone, "p_burst_limit" integer, "p_hour_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_survey_id" "uuid", "p_ip_hash" "text", "p_now" timestamp with time zone, "p_burst_limit" integer, "p_hour_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_survey_id" "uuid", "p_ip_hash" "text", "p_now" timestamp with time zone, "p_burst_limit" integer, "p_hour_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_campaign_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_campaign_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_campaign_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_group_counts"("p_survey_id" "uuid", "p_group_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_group_counts"("p_survey_id" "uuid", "p_group_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_group_counts"("p_survey_id" "uuid", "p_group_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_response_timeseries"("p_survey_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_response_timeseries"("p_survey_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_response_timeseries"("p_survey_id" "uuid", "p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_topic_aggregates"("p_survey_id" "uuid", "p_group_key" "text", "p_group_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_topic_aggregates"("p_survey_id" "uuid", "p_group_key" "text", "p_group_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_topic_aggregates"("p_survey_id" "uuid", "p_group_key" "text", "p_group_value" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."answers" TO "anon";
GRANT ALL ON TABLE "public"."answers" TO "authenticated";
GRANT ALL ON TABLE "public"."answers" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_events" TO "anon";
GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT ALL ON TABLE "public"."client_program_availability_requests" TO "anon";
GRANT ALL ON TABLE "public"."client_program_availability_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."client_program_availability_requests" TO "service_role";



GRANT ALL ON TABLE "public"."client_programs" TO "anon";
GRANT ALL ON TABLE "public"."client_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_programs" TO "service_role";



GRANT ALL ON TABLE "public"."client_reports" TO "anon";
GRANT ALL ON TABLE "public"."client_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."client_reports" TO "service_role";



GRANT ALL ON TABLE "public"."client_sectors" TO "anon";
GRANT ALL ON TABLE "public"."client_sectors" TO "authenticated";
GRANT ALL ON TABLE "public"."client_sectors" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."drps_assessments" TO "anon";
GRANT ALL ON TABLE "public"."drps_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."drps_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."drps_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."drps_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."drps_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."employee_responses" TO "anon";
GRANT ALL ON TABLE "public"."employee_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_responses" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."manager_notifications" TO "anon";
GRANT ALL ON TABLE "public"."manager_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."manager_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."periodic_programs" TO "anon";
GRANT ALL ON TABLE "public"."periodic_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."periodic_programs" TO "service_role";



GRANT ALL ON TABLE "public"."questions" TO "anon";
GRANT ALL ON TABLE "public"."questions" TO "authenticated";
GRANT ALL ON TABLE "public"."questions" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "anon";
GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."responses" TO "anon";
GRANT ALL ON TABLE "public"."responses" TO "authenticated";
GRANT ALL ON TABLE "public"."responses" TO "service_role";



GRANT ALL ON TABLE "public"."survey_group_dimensions" TO "anon";
GRANT ALL ON TABLE "public"."survey_group_dimensions" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_group_dimensions" TO "service_role";



GRANT ALL ON TABLE "public"."survey_group_options" TO "anon";
GRANT ALL ON TABLE "public"."survey_group_options" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_group_options" TO "service_role";



GRANT ALL ON TABLE "public"."survey_sectors" TO "anon";
GRANT ALL ON TABLE "public"."survey_sectors" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_sectors" TO "service_role";



GRANT ALL ON TABLE "public"."surveys" TO "anon";
GRANT ALL ON TABLE "public"."surveys" TO "authenticated";
GRANT ALL ON TABLE "public"."surveys" TO "service_role";



GRANT ALL ON TABLE "public"."topics" TO "anon";
GRANT ALL ON TABLE "public"."topics" TO "authenticated";
GRANT ALL ON TABLE "public"."topics" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict 9RgBQxXhaT2VKzYCe9LMRYHJtdhGLruaSHckJH7KRRd6d8coT0n0FvjPB2plWI4

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."audit_log_entries" ("instance_id", "id", "payload", "created_at", "ip_address") FROM stdin;
\.


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."custom_oauth_providers" ("id", "provider_type", "identifier", "name", "client_id", "client_secret", "acceptable_client_ids", "scopes", "pkce_enabled", "attribute_mapping", "authorization_params", "enabled", "email_optional", "issuer", "discovery_url", "skip_nonce_check", "cached_discovery", "discovery_cached_at", "authorization_url", "token_url", "userinfo_url", "jwks_uri", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."flow_state" ("id", "user_id", "auth_code", "code_challenge_method", "code_challenge", "provider_type", "provider_access_token", "provider_refresh_token", "created_at", "updated_at", "authentication_method", "auth_code_issued_at", "invite_token", "referrer", "oauth_client_state_id", "linking_target_id", "email_optional") FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") FROM stdin;
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") FROM stdin;
\.


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."instances" ("id", "uuid", "raw_base_config", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_clients" ("id", "client_secret_hash", "registration_type", "redirect_uris", "grant_types", "client_name", "client_uri", "logo_uri", "created_at", "updated_at", "deleted_at", "client_type", "token_endpoint_auth_method") FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") FROM stdin;
\.


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") FROM stdin;
\.


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."mfa_factors" ("id", "user_id", "friendly_name", "factor_type", "status", "created_at", "updated_at", "secret", "phone", "last_challenged_at", "web_authn_credential", "web_authn_aaguid", "last_webauthn_challenge_data") FROM stdin;
\.


--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."mfa_challenges" ("id", "factor_id", "created_at", "verified_at", "ip_address", "otp_code", "web_authn_session_data") FROM stdin;
\.


--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_authorizations" ("id", "authorization_id", "client_id", "user_id", "redirect_uri", "scope", "state", "resource", "code_challenge", "code_challenge_method", "response_type", "status", "authorization_code", "created_at", "expires_at", "approved_at", "nonce") FROM stdin;
\.


--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_client_states" ("id", "provider_type", "code_verifier", "created_at") FROM stdin;
\.


--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_consents" ("id", "user_id", "client_id", "scopes", "granted_at", "revoked_at") FROM stdin;
\.


--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."one_time_tokens" ("id", "user_id", "token_type", "token_hash", "relates_to", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") FROM stdin;
\.


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."sso_providers" ("id", "resource_id", "created_at", "updated_at", "disabled") FROM stdin;
\.


--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."saml_providers" ("id", "sso_provider_id", "entity_id", "metadata_xml", "metadata_url", "attribute_mapping", "created_at", "updated_at", "name_id_format") FROM stdin;
\.


--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."saml_relay_states" ("id", "sso_provider_id", "request_id", "for_email", "redirect_to", "created_at", "updated_at", "flow_state_id") FROM stdin;
\.


--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."sso_domains" ("id", "sso_provider_id", "domain", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: clients; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."clients" ("client_id", "company_name", "cnpj", "total_employees", "status", "portal_slug", "contact_name", "contact_email", "contact_phone", "remote_employees", "onsite_employees", "hybrid_employees", "billing_status", "contract_start_date", "contract_end_date", "updated_at", "absenteeism_rate", "turnover_rate", "mental_health_leave_cases", "organizational_climate_reports") FROM stdin;
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	Logistica Delta	22.334.556/0001-77	310	Pending	logistica-delta	\N	\N	\N	0	0	0	pending	\N	\N	2026-03-03 00:27:35.872822+00	\N	\N	\N	\N
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	TechCorp Brasil	12.345.678/0001-90	150	Active	techcorp-brasil	Ana Ribeiro	ana.ribeiro@techcorp.com.br	+55 11 98888-1001	58	72	20	up_to_date	2026-01-01	2026-12-31	2026-03-03 00:55:09.62241+00	\N	\N	\N	\N
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	Varejo Horizonte	45.678.901/0001-22	230	Pending	varejo-horizonte	Fernanda Luz	fernanda.luz@varejohorizonte.com.br	+55 21 96666-3003	25	170	35	pending	2026-01-01	2026-12-31	2026-03-03 00:55:09.62241+00	\N	\N	\N	\N
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005	Servicos Orion	11.222.333/0001-44	90	Active	servicos-orion	Marcos Vieira	marcos.vieira@orion.com.br	+55 41 95555-4004	18	60	12	up_to_date	2026-01-01	2026-12-31	2026-03-03 00:55:09.62241+00	\N	\N	\N	\N
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	Construtora Aurora	66.777.888/0001-99	260	Pending	construtora-aurora	Paulo Teixeira	paulo.teixeira@aurora.com.br	+55 51 94444-5005	12	220	28	pending	2026-02-01	2027-01-31	2026-03-03 01:12:33.192+00	\N	\N	\N	\N
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	Industria Alfa	98.765.432/0001-10	420	Active	industria-alfa	Carlos Mendes	carlos.mendes@industriaalfa.com.br	+55 31 97777-2002	30	360	30	overdue	2026-01-01	2026-12-31	2026-03-03 15:35:19.382+00	\N	\N	\N	\N
\.


--
-- Data for Name: surveys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."surveys" ("id", "name", "public_slug", "status", "likert_min", "likert_max", "k_anonymity_min", "session_ttl_minutes", "turnstile_site_key", "turnstile_expected_hostname", "starts_at", "closes_at", "created_at", "updated_at", "client_id") FROM stdin;
11111111-1111-1111-1111-111111111001	Campanha Demo NR1 2026	demo-nr1-2026	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 19:25:56.586828+00	2026-03-01 19:25:56.586828+00	\N
dbec8e24-271b-4419-82d9-9f9289df1043	DRPS Construtora Aurora	construtora-aurora-drps-construtora-aurora	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 23:40:32.592961+00	2026-03-01 23:40:32.592961+00	\N
6c80e3ed-1af1-4bf7-9687-4a23f30f07e3	DRPS Construtora Aurora 03/2026	construtora-aurora-drps-construtora-aurora-03-2026	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 23:40:57.955511+00	2026-03-01 23:40:57.955511+00	\N
f622adef-5f95-4d06-b09d-73f953035dc7	DRPS Construtora Aurora 03/2026	construtora-aurora-drps-construtora-aurora-03-2026-2	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 23:41:01.360158+00	2026-03-01 23:41:01.360158+00	\N
e3e0134a-68c4-4361-8cc7-66531a48ef3c	drps2026	construtora-aurora-drps2026	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 23:41:37.381003+00	2026-03-01 23:41:37.381003+00	\N
7812723a-01f1-4182-894d-c8f8f319ac40	fsddfs	construtora-aurora-fsddfs	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 13:28:07.076315+00	2026-03-02 13:28:07.076315+00	\N
bd278f66-eaaa-4b37-b7e9-a3cc4a165499	DRPS Construtora Aurora 03/2026	construtora-aurora-drps-construtora-aurora-03-2026-3	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 13:30:31.848571+00	2026-03-02 13:30:31.848571+00	\N
e0f4c2c4-f945-4a64-9473-8bdc87b0373d	sdfsd	construtora-aurora-sdfsd	draft	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 13:30:45.680631+00	2026-03-02 13:30:45.680631+00	\N
6ce32a10-9bf1-4b86-9d7a-e440fb1a6319	DRPS 2026 - Q1 - Construtora Aurora	construtora-aurora-drps-2026-q1-construtora-aurora	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 13:52:05.239792+00	2026-03-02 13:52:05.239792+00	\N
609af817-814f-4c2d-a631-c9074494aae1	DRPS 2026 - Q2 Simulacao 20 colaboradores - Construtora Aurora	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-construtora-aurora	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 13:52:27.056058+00	2026-03-02 13:52:27.056058+00	\N
8f9af660-73ff-48fe-aebd-0de3f9c1df59	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil	techcorp-brasil-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 13:54:02.976769+00	2026-03-02 13:54:02.976769+00	\N
cccccccc-cccc-cccc-cccc-cccccccc2001	DRPS 2026 - Q1	legacy-tc-2026-q1-xyz-cccccccc	closed	1	5	5	30	1x00000000000000000000AA	localhost	2026-01-10 00:00:00+00	2026-02-15 00:00:00+00	2026-01-10 00:00:00+00	2026-03-02 21:49:49.811597+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001
cccccccc-cccc-cccc-cccc-cccccccc2002	DRPS 2026 - Q1	legacy-ia-2026-q1-xyz-cccccccc	closed	1	5	5	30	1x00000000000000000000AA	localhost	2026-01-12 00:00:00+00	2026-02-20 00:00:00+00	2026-01-12 00:00:00+00	2026-03-02 21:49:49.811597+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002
cccccccc-cccc-cccc-cccc-cccccccc2003	DRPS 2026 - Q1	legacy-vh-2026-q1-xyz-cccccccc	closed	1	5	5	30	1x00000000000000000000AA	localhost	2026-01-15 00:00:00+00	2026-02-22 00:00:00+00	2026-01-15 00:00:00+00	2026-03-02 21:49:49.811597+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003
cccccccc-cccc-cccc-cccc-cccccccc2004	DRPS 2026 - Q1	legacy-ld-2026-q1-xyz-cccccccc	live	1	5	5	30	1x00000000000000000000AA	localhost	2026-02-01 00:00:00+00	\N	2026-02-01 00:00:00+00	2026-03-02 21:49:49.811597+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004
cccccccc-cccc-cccc-cccc-cccccccc2010	DRPS 2026 - Q2 Simulacao 20 colaboradores	legacy-tc-2026-q2-sim20-cccccccc	closed	1	5	5	30	1x00000000000000000000AA	localhost	2026-03-01 00:00:00+00	2026-03-02 00:00:00+00	2026-03-01 00:00:00+00	2026-03-02 21:49:49.811597+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001
38795b48-5b66-4576-bfa8-1ea0223e57b1	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil	techcorp-brasil-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-2	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 14:02:32.919446+00	2026-03-02 14:02:32.919446+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001
2b62207e-fe2f-4a3a-8ad2-c99399e88d57	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil	techcorp-brasil-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil	closed	1	5	5	30	1x00000000000000000000AA	localhost	\N	2026-03-02 15:34:09.922+00	2026-03-02 15:33:34.150378+00	2026-03-02 15:33:34.150378+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001
898162b4-0df4-41c0-b660-08ae42921b5f	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:02:09.098832+00	2026-03-02 23:02:09.098832+00	\N
30b0db18-fb03-416d-9789-aff8abaaff0b	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-2	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:02:21.023734+00	2026-03-02 23:02:21.023734+00	\N
46f08f19-844a-4ba0-bace-0a6a7dedfcbc	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-3	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:19:39.421683+00	2026-03-02 23:19:39.421683+00	\N
8ca47a1b-fe6a-4225-a9d4-d74917baff1f	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-4	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:25:31.829055+00	2026-03-02 23:25:31.829055+00	\N
1a195567-49ff-43de-8d82-f39ee3c6f52a	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-construtora-aurora-empresa-geral	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:27:18.862326+00	2026-03-02 23:27:18.862326+00	\N
db78b658-294e-4cd9-9311-b92195697fb0	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-5	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:27:25.396247+00	2026-03-02 23:27:25.396247+00	\N
a18c3be8-6893-4232-8ffa-e61f84049496	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-6	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:30:32.249557+00	2026-03-02 23:30:32.249557+00	\N
93559c7b-1836-48c5-bd6d-cd895e547b6e	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-7	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:35:46.053061+00	2026-03-02 23:35:46.053061+00	\N
d93d219a-610d-42f5-a5c9-d6d355b236f2	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-construtora-aurora-empresa-geral-2	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-02 23:35:53.899661+00	2026-03-02 23:35:53.899661+00	\N
11111111-1111-1111-1111-111111111002	TechCorp Brasil - DRPS 2026 Q1	techcorp-brasil-2026-q1	live	1	5	3	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 20:44:43.786429+00	2026-03-01 20:44:43.786429+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001
11111111-1111-1111-1111-111111111003	Industria Alfa - DRPS 2026 Q1	industria-alfa-2026-q1	live	1	5	3	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 20:44:43.786429+00	2026-03-01 20:44:43.786429+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002
11111111-1111-1111-1111-111111111004	Varejo Horizonte - DRPS 2026 Q1	varejo-horizonte-2026-q1	live	1	5	3	30	1x00000000000000000000AA	localhost	\N	\N	2026-03-01 20:44:43.786429+00	2026-03-01 20:44:43.786429+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003
378e240e-0713-4a21-b150-55a601ea1901	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral - Construtora Aurora -	construtora-aurora-construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-construtora-aurora-empresa	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	2026-03-03 13:41:00+00	2026-03-03 13:40:29.268168+00	2026-03-03 13:40:29.268168+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006
11111111-1111-1111-1111-111111111020	TechCorp Brasil - DRPS 2026 Q2 (Simulacao 20 colaboradores)	techcorp-brasil-2026-q2-sim-20	live	1	5	5	30	1x00000000000000000000AA	localhost	\N	2026-03-03 15:18:00+00	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001
\.


--
-- Data for Name: topics; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."topics" ("id", "code", "name") FROM stdin;
1	T01	Assedio de qualquer natureza
2	T02	Falta de suporte/apoio
3	T03	Ma gestao de mudancas
4	T04	Baixa clareza de papel
5	T05	Baixas recompensas e reconhecimento
6	T06	Baixo controle/falta de autonomia
7	T07	Baixa justica organizacional
8	T08	Eventos violentos/traumaticos
9	T09	Baixa demanda (subcarga)
10	T10	Excesso de demanda (sobrecarga)
11	T11	Maus relacionamentos
12	T12	Dificil comunicacao
13	T13	Trabalho remoto e isolado
\.


--
-- Data for Name: questions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."questions" ("id", "survey_id", "topic_id", "question_code", "position", "prompt", "dimension", "scoring_rule", "is_active", "is_required", "source_excel_col", "created_at") FROM stdin;
ee61b760-33ec-47b3-9cb7-d3ce09ce67bc	11111111-1111-1111-1111-111111111001	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-01 19:25:56.586828+00
647531aa-3c2d-4e05-b6d5-8b60644fefa8	11111111-1111-1111-1111-111111111001	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-01 19:25:56.586828+00
b3a886fa-cc24-4b94-a214-620fc10abfca	11111111-1111-1111-1111-111111111001	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-01 19:25:56.586828+00
6eec01e8-5113-428d-9b12-d9869241598e	11111111-1111-1111-1111-111111111001	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-01 19:25:56.586828+00
6bf331f2-c350-469b-8c2e-c766e99604a0	11111111-1111-1111-1111-111111111001	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-01 19:25:56.586828+00
0efb0d56-bf63-4d09-95cf-cda21efc3eab	11111111-1111-1111-1111-111111111001	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-01 19:25:56.586828+00
b0671856-396f-411c-8918-d1dc905cb9da	11111111-1111-1111-1111-111111111001	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-01 19:25:56.586828+00
25570879-0821-44ee-bc9b-574da521a625	11111111-1111-1111-1111-111111111001	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-01 19:25:56.586828+00
649aab07-6180-48b0-820c-20a94015940d	11111111-1111-1111-1111-111111111001	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-01 19:25:56.586828+00
00c196b1-ca5a-4899-b141-019a1196d0f7	11111111-1111-1111-1111-111111111001	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-01 19:25:56.586828+00
5c881640-0ef6-460d-b406-b16dcd9f7452	11111111-1111-1111-1111-111111111001	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-01 19:25:56.586828+00
23be58e2-f7a1-4492-bc90-c17ab51ecf63	11111111-1111-1111-1111-111111111001	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-01 19:25:56.586828+00
b18e87e1-f38a-4e18-9dfc-cbbeba636b58	11111111-1111-1111-1111-111111111001	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-01 19:25:56.586828+00
4e0f06c7-c4b2-4c12-95e8-cf967130f700	11111111-1111-1111-1111-111111111001	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-01 19:25:56.586828+00
3bcc2cdd-b838-4dd6-a0d7-aef40beb7d38	11111111-1111-1111-1111-111111111001	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-01 19:25:56.586828+00
78bbd372-c3d9-4632-809b-fc654a784e2a	11111111-1111-1111-1111-111111111001	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-01 19:25:56.586828+00
197bcae7-bcd2-463c-a1ed-37bc8abfb93a	11111111-1111-1111-1111-111111111001	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-01 19:25:56.586828+00
61ec5084-9295-4826-9f15-7e45078fa5ab	11111111-1111-1111-1111-111111111001	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-01 19:25:56.586828+00
7b06fa87-9e7c-4321-b164-4cf8bd6ba607	11111111-1111-1111-1111-111111111001	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-01 19:25:56.586828+00
f1cccb7a-3267-43d6-95b4-558582dc8e7b	11111111-1111-1111-1111-111111111001	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-01 19:25:56.586828+00
75a80553-3f83-4a36-814f-1acb73883dd9	11111111-1111-1111-1111-111111111001	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-01 19:25:56.586828+00
e489acaa-d32f-49b9-ae77-2e44f2507bc6	11111111-1111-1111-1111-111111111001	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-01 19:25:56.586828+00
6564b6f2-2944-4ba3-bccd-730ead99e6eb	11111111-1111-1111-1111-111111111001	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-01 19:25:56.586828+00
2a527701-7c90-4704-b428-5990d0e4b77a	11111111-1111-1111-1111-111111111001	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-01 19:25:56.586828+00
0aab2c22-c3bf-46b4-8d81-8d7bbf4b27e2	11111111-1111-1111-1111-111111111001	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-01 19:25:56.586828+00
5a070666-ff73-4743-b37f-04863b418510	11111111-1111-1111-1111-111111111001	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-01 19:25:56.586828+00
40b4f64e-333d-405a-9453-fea44ad021c3	11111111-1111-1111-1111-111111111001	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-01 19:25:56.586828+00
3a36a09f-f021-4173-a40e-540beb2eac75	11111111-1111-1111-1111-111111111001	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-01 19:25:56.586828+00
93e5a8e9-ba6f-42e0-957c-7a9da097902d	11111111-1111-1111-1111-111111111001	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-01 19:25:56.586828+00
346e7d73-dffc-44d0-9ed7-5ccec688d803	11111111-1111-1111-1111-111111111001	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-01 19:25:56.586828+00
5eb435a5-8d7b-4b24-ac02-cacc819474a8	11111111-1111-1111-1111-111111111001	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-01 19:25:56.586828+00
de3d1641-5157-4d4e-81f1-ea15a1afa0fb	11111111-1111-1111-1111-111111111001	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-01 19:25:56.586828+00
fab21348-959e-440d-96bc-df25375149ea	11111111-1111-1111-1111-111111111001	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-01 19:25:56.586828+00
64f1da2e-dae0-44ba-8f15-2607beb49753	11111111-1111-1111-1111-111111111001	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-01 19:25:56.586828+00
9cac7b0e-c13f-4d6d-b6d5-d2f81ecdaf6d	11111111-1111-1111-1111-111111111001	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-01 19:25:56.586828+00
4d0f208d-317e-49f8-8c84-51151402c1a0	11111111-1111-1111-1111-111111111001	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-01 19:25:56.586828+00
7ec627e9-34f7-46da-be99-d9d6066754d4	11111111-1111-1111-1111-111111111001	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-01 19:25:56.586828+00
0bdc7f9f-d6ee-49df-9487-68b47ad28dd4	11111111-1111-1111-1111-111111111001	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-01 19:25:56.586828+00
736a2648-0115-4450-abf7-7da83ccfa35c	11111111-1111-1111-1111-111111111001	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-01 19:25:56.586828+00
019eff4c-916c-47b8-9cca-515bc7bde318	11111111-1111-1111-1111-111111111001	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-01 19:25:56.586828+00
988ce211-0270-4c6f-9412-4e2eacf2f7d1	11111111-1111-1111-1111-111111111001	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-01 19:25:56.586828+00
c74ecf06-0176-45e0-856b-113b736d49aa	11111111-1111-1111-1111-111111111001	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-01 19:25:56.586828+00
88db673d-a8a5-40b2-912b-06f08e148220	11111111-1111-1111-1111-111111111001	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-01 19:25:56.586828+00
6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	11111111-1111-1111-1111-111111111003	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-01 20:44:43.786429+00
47e36c24-0926-46f4-9b2d-d24fa7c37c2a	11111111-1111-1111-1111-111111111001	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-01 19:25:56.586828+00
bd376e0b-cdf5-4658-86be-8b380e4b9018	11111111-1111-1111-1111-111111111001	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-01 19:25:56.586828+00
6a97ea16-3d6a-4ce8-9544-5574646a6742	11111111-1111-1111-1111-111111111001	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-01 19:25:56.586828+00
7e3ffa55-dd42-4206-8a9b-0ce41d81a2c4	11111111-1111-1111-1111-111111111001	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-01 19:25:56.586828+00
f5ad8f3d-a8aa-47b8-a259-7ff5d564f1cb	11111111-1111-1111-1111-111111111001	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-01 19:25:56.586828+00
38cb0907-754a-4e1d-b007-ba748815d72e	11111111-1111-1111-1111-111111111001	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-01 19:25:56.586828+00
97caf7a1-f4ed-4818-9694-edef1b6e9b09	11111111-1111-1111-1111-111111111001	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-01 19:25:56.586828+00
fa227ee2-829d-4d24-b65a-9f769a471169	11111111-1111-1111-1111-111111111002	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-01 20:44:43.786429+00
7eb57d97-96a7-421a-ae95-9bfb540efcb2	11111111-1111-1111-1111-111111111002	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-01 20:44:43.786429+00
22b0c14c-8266-4e94-ab0d-90524adfed06	11111111-1111-1111-1111-111111111002	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-01 20:44:43.786429+00
af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	11111111-1111-1111-1111-111111111002	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-01 20:44:43.786429+00
e7856868-6d88-4196-866c-d197941da4ee	11111111-1111-1111-1111-111111111002	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-01 20:44:43.786429+00
5da3d90a-7c43-4601-bdea-592bfaf0e7ba	11111111-1111-1111-1111-111111111002	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-01 20:44:43.786429+00
a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	11111111-1111-1111-1111-111111111002	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-01 20:44:43.786429+00
b5c31995-1fa3-4e1c-af85-f455824153ef	11111111-1111-1111-1111-111111111002	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-01 20:44:43.786429+00
5d8b725c-8446-4e77-a1fb-f6f71870e8a1	11111111-1111-1111-1111-111111111002	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-01 20:44:43.786429+00
54a6c32d-dd91-4677-85db-13ade5cd5f28	11111111-1111-1111-1111-111111111002	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-01 20:44:43.786429+00
502b89aa-6e38-4535-9a4f-37f2218dbc3e	11111111-1111-1111-1111-111111111002	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-01 20:44:43.786429+00
e775bafe-7b32-4dd7-9563-334494dee19c	11111111-1111-1111-1111-111111111002	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-01 20:44:43.786429+00
62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	11111111-1111-1111-1111-111111111002	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-01 20:44:43.786429+00
9ad06b83-bfe3-4800-9fa4-4eacae61b778	11111111-1111-1111-1111-111111111002	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-01 20:44:43.786429+00
c89e499d-d0b5-4713-9375-02f398da80cd	11111111-1111-1111-1111-111111111002	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-01 20:44:43.786429+00
c0721650-1bdb-439b-8619-e80598f6c42c	11111111-1111-1111-1111-111111111002	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-01 20:44:43.786429+00
f288d8fd-0be1-414c-8351-ec8e8dfebeb4	11111111-1111-1111-1111-111111111002	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-01 20:44:43.786429+00
d1391709-bc62-46c3-a969-6d6bceb6fc14	11111111-1111-1111-1111-111111111002	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-01 20:44:43.786429+00
703a1653-c4ca-414c-82d1-46df9a0c52f8	11111111-1111-1111-1111-111111111002	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-01 20:44:43.786429+00
c6360468-cfbc-4122-bc6a-ac6b03dff854	11111111-1111-1111-1111-111111111002	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-01 20:44:43.786429+00
9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	11111111-1111-1111-1111-111111111002	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-01 20:44:43.786429+00
04214f99-8036-489b-b4f9-9ea6b8d71f68	11111111-1111-1111-1111-111111111002	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-01 20:44:43.786429+00
ed43de58-a0d4-4f66-b24c-0f3384d54151	11111111-1111-1111-1111-111111111002	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-01 20:44:43.786429+00
77139fe5-366a-46b8-9579-ce5092982354	11111111-1111-1111-1111-111111111002	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-01 20:44:43.786429+00
bdc178df-4905-4110-a4d2-e35ccf32f8fc	11111111-1111-1111-1111-111111111002	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-01 20:44:43.786429+00
eb935899-1944-4a95-b3e9-5117792ff720	11111111-1111-1111-1111-111111111002	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-01 20:44:43.786429+00
513cc29b-1639-4c5e-aa75-5d0291384fbf	11111111-1111-1111-1111-111111111002	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-01 20:44:43.786429+00
a1217b01-53b4-4e60-9278-5ca1ac6efd99	11111111-1111-1111-1111-111111111002	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-01 20:44:43.786429+00
0dd75b17-6461-475f-b88b-af646eafd3e5	11111111-1111-1111-1111-111111111002	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-01 20:44:43.786429+00
4678a6d3-121f-4e5f-879f-c98259dc22a4	11111111-1111-1111-1111-111111111002	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-01 20:44:43.786429+00
420b8356-678e-40be-9eed-c20dbcb4d4e7	11111111-1111-1111-1111-111111111002	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-01 20:44:43.786429+00
ed641033-fc30-49f2-bc5d-ffa50ee88bf9	11111111-1111-1111-1111-111111111002	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-01 20:44:43.786429+00
811aa622-3bbb-4096-bcb7-e78da1bc3ad3	11111111-1111-1111-1111-111111111002	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-01 20:44:43.786429+00
d8efe4be-dc17-4126-b007-bec54fc05d06	11111111-1111-1111-1111-111111111002	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-01 20:44:43.786429+00
393543c4-bd1e-4b60-9fa4-20131df0cc84	11111111-1111-1111-1111-111111111002	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-01 20:44:43.786429+00
ee81c937-be87-4090-baaf-df1e91f11b04	11111111-1111-1111-1111-111111111002	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-01 20:44:43.786429+00
a52c0fd6-e633-4804-a634-21aaf56b829e	11111111-1111-1111-1111-111111111002	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-01 20:44:43.786429+00
c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	11111111-1111-1111-1111-111111111002	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-01 20:44:43.786429+00
4b09cf47-9671-4223-b0ae-13ed1cb28053	11111111-1111-1111-1111-111111111002	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-01 20:44:43.786429+00
3741e4b0-2c50-4870-bd9b-a1058250910f	11111111-1111-1111-1111-111111111002	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-01 20:44:43.786429+00
61d6125b-9d1b-4343-9e22-d92f6784643d	11111111-1111-1111-1111-111111111002	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-01 20:44:43.786429+00
0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	11111111-1111-1111-1111-111111111002	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-01 20:44:43.786429+00
d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	11111111-1111-1111-1111-111111111002	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-01 20:44:43.786429+00
5923452c-9708-4f78-a19f-1cc1ac3f8d21	11111111-1111-1111-1111-111111111002	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-01 20:44:43.786429+00
33c5bb28-89b7-49b8-bb13-2eabef7c14fd	11111111-1111-1111-1111-111111111002	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-01 20:44:43.786429+00
43a91ee4-2a48-4669-ba17-f31547b03933	11111111-1111-1111-1111-111111111002	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-01 20:44:43.786429+00
449df3e2-8c09-453c-afe8-b44dcf499411	11111111-1111-1111-1111-111111111002	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-01 20:44:43.786429+00
8bdf677a-6bea-4f63-8163-4da713e16246	11111111-1111-1111-1111-111111111002	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-01 20:44:43.786429+00
0adbd4cd-91bf-4a14-bb16-629eebd93a9f	11111111-1111-1111-1111-111111111002	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-01 20:44:43.786429+00
a0e877e9-7495-4f3f-913e-f4862c5a10ce	11111111-1111-1111-1111-111111111002	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-01 20:44:43.786429+00
597b2b64-285e-4c74-a051-a03b6d2b098c	11111111-1111-1111-1111-111111111003	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-01 20:44:43.786429+00
13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	11111111-1111-1111-1111-111111111003	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-01 20:44:43.786429+00
d82b701c-f517-41cd-9502-bfc628ae34c8	11111111-1111-1111-1111-111111111003	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-01 20:44:43.786429+00
204766c8-cd09-40cb-9390-118420ec13a2	11111111-1111-1111-1111-111111111003	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-01 20:44:43.786429+00
a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	11111111-1111-1111-1111-111111111003	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-01 20:44:43.786429+00
0c780662-690d-4cb7-b0ce-7847accd58e7	11111111-1111-1111-1111-111111111003	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-01 20:44:43.786429+00
e6a61f45-2287-4c82-a113-093b1c51f99a	11111111-1111-1111-1111-111111111003	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-01 20:44:43.786429+00
9ea10479-74e2-451a-9bab-f73732b5a5b4	11111111-1111-1111-1111-111111111003	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-01 20:44:43.786429+00
2cff8649-d188-4ca2-ad01-257c7c6f4572	11111111-1111-1111-1111-111111111003	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-01 20:44:43.786429+00
2b010dcb-277f-4e71-bd4d-4ecfba6da696	11111111-1111-1111-1111-111111111003	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-01 20:44:43.786429+00
f1ffd4dc-dcba-4b92-96f0-a61311b50014	11111111-1111-1111-1111-111111111003	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-01 20:44:43.786429+00
d830cf68-47a2-4b03-b2a8-353502d2841d	11111111-1111-1111-1111-111111111003	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-01 20:44:43.786429+00
86a8afe3-c11e-4425-bc95-0a43345386ae	11111111-1111-1111-1111-111111111003	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-01 20:44:43.786429+00
707ceae0-ff38-4751-92b3-446a7b517b1d	11111111-1111-1111-1111-111111111003	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-01 20:44:43.786429+00
00cd032c-1ac3-4332-9cad-7b2bf0ff1def	11111111-1111-1111-1111-111111111003	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-01 20:44:43.786429+00
971246f4-407c-432b-baf6-6af963c20b93	11111111-1111-1111-1111-111111111003	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-01 20:44:43.786429+00
cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	11111111-1111-1111-1111-111111111003	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-01 20:44:43.786429+00
2d084653-66bc-41dc-9dc8-f6ef8ca7af88	11111111-1111-1111-1111-111111111003	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-01 20:44:43.786429+00
3a511eaf-4a22-4924-92d0-1bc671c86371	11111111-1111-1111-1111-111111111003	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-01 20:44:43.786429+00
8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	11111111-1111-1111-1111-111111111003	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-01 20:44:43.786429+00
7b9ec861-348a-4df3-9f34-a197b270f2ae	11111111-1111-1111-1111-111111111003	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-01 20:44:43.786429+00
de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	11111111-1111-1111-1111-111111111003	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-01 20:44:43.786429+00
7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	11111111-1111-1111-1111-111111111003	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-01 20:44:43.786429+00
a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	11111111-1111-1111-1111-111111111003	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-01 20:44:43.786429+00
070071c5-7927-4bd6-adf6-fdecfa689009	11111111-1111-1111-1111-111111111003	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-01 20:44:43.786429+00
71ab61c1-ab73-4e09-ade5-0da77b4d35b2	11111111-1111-1111-1111-111111111003	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-01 20:44:43.786429+00
a175b7b2-c5f8-4e09-93cc-28fa05afb991	11111111-1111-1111-1111-111111111003	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-01 20:44:43.786429+00
c0ab206f-94c4-4f80-bfff-2a2fce4828e5	11111111-1111-1111-1111-111111111003	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-01 20:44:43.786429+00
3e1748d8-8c2c-467c-adbc-8ba87c8bd442	11111111-1111-1111-1111-111111111003	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-01 20:44:43.786429+00
3738963a-8326-4fb5-b77a-2478b07be378	11111111-1111-1111-1111-111111111003	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-01 20:44:43.786429+00
19c3570a-b1e4-415f-b2e6-9008459e40dd	11111111-1111-1111-1111-111111111003	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-01 20:44:43.786429+00
e4604f2a-4c6d-4a7e-a985-7d70bb857c57	11111111-1111-1111-1111-111111111003	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-01 20:44:43.786429+00
e2d1c78f-19e2-4aa2-b523-776e558191d4	11111111-1111-1111-1111-111111111003	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-01 20:44:43.786429+00
a65aecba-2bc9-43a5-be5d-412d495a3705	11111111-1111-1111-1111-111111111003	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-01 20:44:43.786429+00
3cad095c-270c-4de0-8ba3-4c1dfd497c23	11111111-1111-1111-1111-111111111003	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-01 20:44:43.786429+00
3ec1b43f-e7cf-484d-9a56-4e589901ebc6	11111111-1111-1111-1111-111111111003	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-01 20:44:43.786429+00
364c8422-e75e-4300-b8f2-b6b11b4172c2	11111111-1111-1111-1111-111111111003	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-01 20:44:43.786429+00
bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	11111111-1111-1111-1111-111111111003	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-01 20:44:43.786429+00
edfef766-6e1e-4f17-9070-2e04d1fbbc77	11111111-1111-1111-1111-111111111003	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-01 20:44:43.786429+00
bcdddfab-8c04-4282-8f7f-c18116652afd	11111111-1111-1111-1111-111111111003	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-01 20:44:43.786429+00
07730b2b-df11-4806-a053-705038165e7b	11111111-1111-1111-1111-111111111003	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-01 20:44:43.786429+00
b8b1a178-760f-4c71-97c6-12aada83de6a	11111111-1111-1111-1111-111111111003	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-01 20:44:43.786429+00
a81bf3fd-93dc-4856-b585-2a4ece018841	11111111-1111-1111-1111-111111111003	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-01 20:44:43.786429+00
f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	11111111-1111-1111-1111-111111111003	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-01 20:44:43.786429+00
9969acc9-e3ec-42e1-9053-425d2a7057cf	11111111-1111-1111-1111-111111111003	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-01 20:44:43.786429+00
ac5e7c06-988c-4938-b39f-64ed27db8170	11111111-1111-1111-1111-111111111003	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-01 20:44:43.786429+00
73228bdb-c235-4347-9d13-6335c95488db	11111111-1111-1111-1111-111111111003	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-01 20:44:43.786429+00
03abc67a-2368-4513-89d2-9312dfd3df57	11111111-1111-1111-1111-111111111003	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-01 20:44:43.786429+00
5276855b-adf4-4d86-bc75-5cbbaef5a33d	11111111-1111-1111-1111-111111111003	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-01 20:44:43.786429+00
79a4bb77-c247-4107-9562-94cf1a9acc3c	11111111-1111-1111-1111-111111111004	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-01 20:44:43.786429+00
9848f7c1-1b26-4df9-bf10-0e302bc8701b	11111111-1111-1111-1111-111111111004	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-01 20:44:43.786429+00
96887867-e8bc-4ec9-8cb1-640549849afa	11111111-1111-1111-1111-111111111004	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-01 20:44:43.786429+00
5c8dd1f7-27a2-4a0e-b936-05769bd08107	11111111-1111-1111-1111-111111111004	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-01 20:44:43.786429+00
5684ac30-3300-4bdd-9da9-c6b3dd36278e	11111111-1111-1111-1111-111111111004	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-01 20:44:43.786429+00
d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	11111111-1111-1111-1111-111111111004	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-01 20:44:43.786429+00
94ae2787-86d4-41fd-84f9-a555a49f81fd	11111111-1111-1111-1111-111111111004	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-01 20:44:43.786429+00
ead35916-20d9-4c34-8492-7a5092c5cbf7	11111111-1111-1111-1111-111111111004	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-01 20:44:43.786429+00
bdffd3df-74a4-407f-9ab8-ca1f01b65af9	11111111-1111-1111-1111-111111111004	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-01 20:44:43.786429+00
e5a01657-96cc-44b5-a5f1-f74a39bc26bd	11111111-1111-1111-1111-111111111004	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-01 20:44:43.786429+00
d5164075-c29a-4980-a14b-094a0fcb33af	11111111-1111-1111-1111-111111111004	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-01 20:44:43.786429+00
82bf517c-9c45-47c5-940d-e6ff2d38a068	11111111-1111-1111-1111-111111111004	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-01 20:44:43.786429+00
a9eb1224-9359-4dc2-848e-bf057e454bf3	11111111-1111-1111-1111-111111111004	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-01 20:44:43.786429+00
ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	11111111-1111-1111-1111-111111111004	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-01 20:44:43.786429+00
6b4310fa-1063-427b-9767-cf495276268f	11111111-1111-1111-1111-111111111004	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-01 20:44:43.786429+00
de9395ef-ec7e-4366-b6f7-ec33753b76b7	11111111-1111-1111-1111-111111111004	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-01 20:44:43.786429+00
c1a74934-6cb6-4f33-908b-a5db71df99ce	11111111-1111-1111-1111-111111111004	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-01 20:44:43.786429+00
d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	11111111-1111-1111-1111-111111111004	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-01 20:44:43.786429+00
577a4c98-02e4-47c1-810c-20c519d69762	11111111-1111-1111-1111-111111111004	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-01 20:44:43.786429+00
328ff049-4619-47e6-b34b-23e214c776ea	11111111-1111-1111-1111-111111111004	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-01 20:44:43.786429+00
5c28e25c-7401-49e5-bf5b-693f5c0b934f	11111111-1111-1111-1111-111111111004	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-01 20:44:43.786429+00
1cbe6f26-acca-4df4-b641-2e74f0644466	11111111-1111-1111-1111-111111111004	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-01 20:44:43.786429+00
486fead0-88a1-4461-b373-356f9ed953cc	11111111-1111-1111-1111-111111111004	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-01 20:44:43.786429+00
6689be60-747a-48e4-86c9-8535e50ed1d0	11111111-1111-1111-1111-111111111004	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-01 20:44:43.786429+00
bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	11111111-1111-1111-1111-111111111004	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-01 20:44:43.786429+00
2d888823-03d5-4f47-8121-c7240b9871c9	11111111-1111-1111-1111-111111111004	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-01 20:44:43.786429+00
038bb428-a2df-41ed-b6dd-f4ed7fe7670d	11111111-1111-1111-1111-111111111004	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-01 20:44:43.786429+00
b27a6406-522f-4516-85d3-2f8f5aad247e	11111111-1111-1111-1111-111111111004	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-01 20:44:43.786429+00
3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	11111111-1111-1111-1111-111111111004	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-01 20:44:43.786429+00
bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	11111111-1111-1111-1111-111111111004	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-01 20:44:43.786429+00
739af3f6-1bc8-4612-8953-79d20c0d076d	11111111-1111-1111-1111-111111111004	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-01 20:44:43.786429+00
ff3addbd-2dfc-427b-be18-f06366fbefaa	11111111-1111-1111-1111-111111111004	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-01 20:44:43.786429+00
20e1688f-7eaf-4210-b869-895d34d1cef9	11111111-1111-1111-1111-111111111004	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-01 20:44:43.786429+00
591af11c-41b9-407e-89fa-8005f96495d1	11111111-1111-1111-1111-111111111004	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-01 20:44:43.786429+00
31ccb2df-3712-48f0-955d-1fe7c0757f2f	11111111-1111-1111-1111-111111111004	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-01 20:44:43.786429+00
0bfc55ba-040a-499f-a175-0f5ead22d76b	11111111-1111-1111-1111-111111111004	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-01 20:44:43.786429+00
611ce17d-46c1-4c03-8f2a-5efecf150353	11111111-1111-1111-1111-111111111004	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-01 20:44:43.786429+00
f0b259c3-b67e-4ab3-865f-87a374ba968a	11111111-1111-1111-1111-111111111004	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-01 20:44:43.786429+00
7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	11111111-1111-1111-1111-111111111004	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-01 20:44:43.786429+00
e120a75c-19fa-43aa-b561-2efa9e3e181b	11111111-1111-1111-1111-111111111004	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-01 20:44:43.786429+00
02c4c493-7a29-4ef3-9532-f48c71227621	11111111-1111-1111-1111-111111111004	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-01 20:44:43.786429+00
1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	11111111-1111-1111-1111-111111111004	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-01 20:44:43.786429+00
57cfd248-7532-414c-bbd8-111378c352ce	11111111-1111-1111-1111-111111111004	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-01 20:44:43.786429+00
934886bd-ebb3-4a70-9f62-71aa3e263d20	11111111-1111-1111-1111-111111111004	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-01 20:44:43.786429+00
d7521969-e5c0-4e02-954e-9f586bbb3fda	11111111-1111-1111-1111-111111111004	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-01 20:44:43.786429+00
cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	11111111-1111-1111-1111-111111111004	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-01 20:44:43.786429+00
e41e4bb4-b564-4184-b1f1-9d3fa7626c03	11111111-1111-1111-1111-111111111004	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-01 20:44:43.786429+00
83955be9-096b-4dfb-9c01-dc3c07149f8f	11111111-1111-1111-1111-111111111004	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-01 20:44:43.786429+00
3fb99c06-b0b0-4b2a-9307-b2fc53815007	11111111-1111-1111-1111-111111111004	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-01 20:44:43.786429+00
31ee7270-e633-49aa-a789-c8e666b3253d	11111111-1111-1111-1111-111111111004	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-01 20:44:43.786429+00
d58e7fa1-fafe-4390-8803-a5fff4af243b	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
2ea5ebff-1068-4771-92b9-d4b46f3a2369	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
d640af51-6833-4704-87dd-978bff7b8667	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
e1a0c8eb-3761-4940-8845-8a1143247397	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
6a6260f4-72ba-477d-a6dd-958c4a784994	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
8271d5bf-34bf-446c-bb24-3595cb7a0bab	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
e778c0dc-d21d-46f1-8683-6714344e7571	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
2289f0a8-1be6-47f1-92fe-f8d415b84d67	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
0ce59e63-b726-44f9-8b0a-7aa449c5eb06	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
1e6d80ff-9087-43c1-8885-13e522f534bd	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
169bb9eb-32ce-4a6c-8be5-bc267dd5061a	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
b1932b0f-49eb-4e40-b671-5cd5e27eb9e2	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
b5e9b64b-f9fd-4ad3-b89f-a26497354b9f	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
4e062fe5-9eab-4bf9-bc2b-9a2e16d0b5e0	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
2e8e3ae3-707b-4ece-9a06-2f35567e931b	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
e5f59cb2-df4a-41c7-99e0-ec73478cd775	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
4fc509ef-5432-4749-be70-9658cc5f79fa	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
9fb882cf-93b7-4dd0-ba43-ac7537a0461d	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
37c964f5-5fab-447d-95b4-ee1255d93135	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
96fd6a66-6cd4-4c56-b1b7-5b723ba72658	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
1bb378e7-67f9-46f4-8009-185db99f4694	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
2c8eed74-c172-44c6-8d19-c3f0d98c206f	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
6a79a204-2d96-4c67-9f52-71921f2df2b0	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
a3d0b226-800f-4290-9d3f-7f74df7e37aa	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
2f48bebd-d865-4c41-bc79-5d7b9d80c910	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
0eb6b1d4-8b8c-4f2d-aa9a-9a94ce6bc97f	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
16eb66e0-2576-40e0-a094-bef29a1c045d	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
d5fd416a-ea05-4ede-b61c-36521bbed69b	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
925c931c-6739-4d03-8408-a2e73bb0f146	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
86da6cd2-f71f-4f35-a77f-034558eb2f65	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
d80ec5b0-8025-4d9c-87f8-0299d71c02fb	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
7ce59563-5fb2-448a-9dec-5e5fed3be195	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
c0d0592f-ee05-45b7-b03b-1ee36215a7e5	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
62fcc866-7535-4248-a317-868288d44592	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
a5cea9f8-5cdf-4db8-9bd1-5bf2270cb53c	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
ea639826-1b82-4cf7-9dd7-7c3ce2a328c5	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
484b4339-089c-445d-9367-82a8956601bb	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
a88c2f1c-27ab-4fc4-80e4-0bfb1d3977bc	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
275140d5-033c-417b-a526-429cb4a09ebd	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
345566dd-daf4-4412-a1f6-19a0148b29ce	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
f9c7bfcc-f53d-4c35-8690-1b9d4133dcd2	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
cf2d2bdb-f2a1-4a7e-a97e-b181183b68dd	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
e958cc1b-fc6f-40fb-8e4f-8610b3efddd6	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
7d679dfc-ba02-47fa-ae01-ade9e32913b0	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
a1195f97-0910-4f96-b65b-d3ce5dcc77bb	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
97dae63b-5fca-41c4-91a7-7eb6b6c10034	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
e635768e-e1f5-45aa-a16c-fe9e5e856d2e	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
7d95e261-4523-432c-b8aa-688c0c6131ed	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
5c0f9cea-9b2f-49a3-827f-331b7a842533	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
faf9b27a-b0a0-4e50-aef2-cdbcbb255c14	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
1da3292b-7709-451e-b787-43df460efd2d	cccccccc-cccc-cccc-cccc-cccccccc2001	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
201f392f-29d7-4ec2-8145-a77350c87391	cccccccc-cccc-cccc-cccc-cccccccc2001	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
0250ed1a-c40d-43ef-9593-198e44e7954b	cccccccc-cccc-cccc-cccc-cccccccc2001	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
1d92a2bd-3a7a-4889-bd8d-68eb41f08ce4	cccccccc-cccc-cccc-cccc-cccccccc2001	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
bc80b83d-7e66-4df3-a7b3-269f7402a35b	cccccccc-cccc-cccc-cccc-cccccccc2001	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
75a418f9-86e8-43bb-8888-eed3593e956c	cccccccc-cccc-cccc-cccc-cccccccc2001	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
a3e9082e-d630-48b1-b479-6a0874b68207	cccccccc-cccc-cccc-cccc-cccccccc2001	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
1d5d9915-b893-4881-afae-a29cdb9539b1	cccccccc-cccc-cccc-cccc-cccccccc2001	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
a87cd19e-bf23-4706-856a-2830523bfc85	cccccccc-cccc-cccc-cccc-cccccccc2001	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
fee48452-f92e-4f1d-badc-3cf1efbb7c88	cccccccc-cccc-cccc-cccc-cccccccc2001	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
f9cec0f4-580e-4ebb-a7b5-dd663aacf63b	cccccccc-cccc-cccc-cccc-cccccccc2001	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
1fbdc8b5-52ff-4c38-acff-5105313f8f6b	cccccccc-cccc-cccc-cccc-cccccccc2001	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
2ce58dba-67a8-4a60-8cf5-335732f5f982	cccccccc-cccc-cccc-cccc-cccccccc2001	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
930d4750-1a1b-4fdf-ab1a-8bdd327c252d	cccccccc-cccc-cccc-cccc-cccccccc2001	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
741e072a-a545-42a5-96d1-a68ef6218d41	cccccccc-cccc-cccc-cccc-cccccccc2001	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
676694d9-8c29-4fb9-85e9-2f1ac1d38914	cccccccc-cccc-cccc-cccc-cccccccc2001	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
2247b41f-8588-4f82-99c1-2fa4a69d9300	cccccccc-cccc-cccc-cccc-cccccccc2001	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
5ec90473-013b-406d-96cc-bffd96e3fe08	cccccccc-cccc-cccc-cccc-cccccccc2001	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
bbf4cec4-1824-41f4-bf4c-1588477c8a17	cccccccc-cccc-cccc-cccc-cccccccc2001	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
08126749-a29b-425d-8f23-eaaaa2449ef7	cccccccc-cccc-cccc-cccc-cccccccc2001	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
94a5155b-13cf-481c-a56b-9160535998fd	cccccccc-cccc-cccc-cccc-cccccccc2001	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
202847fc-ae0f-45b2-854e-eda413a0225c	cccccccc-cccc-cccc-cccc-cccccccc2001	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
e4cecd9f-7972-45bf-a576-ce3530ec9146	cccccccc-cccc-cccc-cccc-cccccccc2001	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
2ef4afc4-618b-49d0-be06-4f28294292cf	cccccccc-cccc-cccc-cccc-cccccccc2001	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
85321017-a782-479e-8fed-f72c4ebb98d0	cccccccc-cccc-cccc-cccc-cccccccc2001	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
ec1095ee-c8c7-466d-9ebf-ef073e648304	cccccccc-cccc-cccc-cccc-cccccccc2001	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
e2ba9a70-c2cc-4096-904e-d0589bfc6777	cccccccc-cccc-cccc-cccc-cccccccc2001	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
0c7427c9-30a9-45af-92c9-76ec4a7f3f4c	cccccccc-cccc-cccc-cccc-cccccccc2001	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
5d4a0219-317b-424e-ae70-bf61fc0fe061	cccccccc-cccc-cccc-cccc-cccccccc2001	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
c6325356-7667-42aa-81a8-92f446f44516	cccccccc-cccc-cccc-cccc-cccccccc2001	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
413ee413-95db-4c4b-abf5-08dfc19c63a8	cccccccc-cccc-cccc-cccc-cccccccc2001	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
7de7d398-6d8f-43a4-92ce-903e2f79756b	cccccccc-cccc-cccc-cccc-cccccccc2001	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
9bd2bf4b-72c3-4a10-bae9-325d391114db	cccccccc-cccc-cccc-cccc-cccccccc2001	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
b6fdf7cb-3bf3-4b9c-a39e-ce3b795ace9b	cccccccc-cccc-cccc-cccc-cccccccc2001	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
e09977c3-0fd3-49d8-a6ff-9b21752a2f22	cccccccc-cccc-cccc-cccc-cccccccc2001	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
e61ff4c2-72b6-4b38-a5af-eb4574254fc4	cccccccc-cccc-cccc-cccc-cccccccc2001	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
8549f55d-f361-4f63-8537-d701ccbf1c41	cccccccc-cccc-cccc-cccc-cccccccc2001	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
8aeb49f1-17bd-4e5b-9d4b-c568838559b2	cccccccc-cccc-cccc-cccc-cccccccc2001	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
068a24ef-ec26-4e61-bd0c-28be33d6692e	cccccccc-cccc-cccc-cccc-cccccccc2001	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
0afdfa4f-d7b3-461e-8d87-be522306e263	cccccccc-cccc-cccc-cccc-cccccccc2001	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
f3eefb41-282d-48dd-af87-c1bb9aff54e6	cccccccc-cccc-cccc-cccc-cccccccc2001	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
8cc25c8f-b722-4942-a89c-df86bc533a1a	cccccccc-cccc-cccc-cccc-cccccccc2001	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
f0971a3c-b9c6-4aaa-a92f-2dfe64276246	cccccccc-cccc-cccc-cccc-cccccccc2001	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
4d624be7-1604-4a8a-b316-64e50ceeb0eb	cccccccc-cccc-cccc-cccc-cccccccc2001	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
015cc239-cdee-4d6e-943d-bbfb1c38a320	cccccccc-cccc-cccc-cccc-cccccccc2001	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
678321a7-9496-48ad-8e78-72619a8ba926	cccccccc-cccc-cccc-cccc-cccccccc2001	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
96a0e222-281b-42e4-a5f5-dba39cbc2c07	cccccccc-cccc-cccc-cccc-cccccccc2001	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
e4e326cd-f708-4420-9cc2-191abb4b0dee	cccccccc-cccc-cccc-cccc-cccccccc2001	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
148ba434-2644-4fe2-ae19-cddbc0977438	cccccccc-cccc-cccc-cccc-cccccccc2001	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
e51473a3-2f07-410d-9d36-321f20eeb93e	cccccccc-cccc-cccc-cccc-cccccccc2001	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
1015e502-511a-4fe0-8096-39d83da70d57	cccccccc-cccc-cccc-cccc-cccccccc2010	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
58f8d80f-b077-469a-96f3-2f634e872396	cccccccc-cccc-cccc-cccc-cccccccc2010	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
1736d8db-3f8c-4f0f-a96a-fe916811c8f5	cccccccc-cccc-cccc-cccc-cccccccc2010	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
8f200e95-9f4b-4491-8142-d59e31d1e1f3	cccccccc-cccc-cccc-cccc-cccccccc2010	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
93c58ae7-6fb5-49bf-8704-a211befc4fae	cccccccc-cccc-cccc-cccc-cccccccc2010	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
12ec4620-e0fe-4803-aaae-4a3832e3d63c	cccccccc-cccc-cccc-cccc-cccccccc2010	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
ddaa58b3-b6fa-4a57-85f1-6d6285d8f6b9	cccccccc-cccc-cccc-cccc-cccccccc2010	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
f26d4b82-e4e8-45e6-af6d-7777e7ce407e	cccccccc-cccc-cccc-cccc-cccccccc2010	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
cb03f387-8b8a-455e-9076-a756fbeadc32	cccccccc-cccc-cccc-cccc-cccccccc2010	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
9105222a-4267-42c9-9b80-3876de0b2457	cccccccc-cccc-cccc-cccc-cccccccc2010	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
84481fe2-bbb1-4dd5-b58d-c2905ad337aa	cccccccc-cccc-cccc-cccc-cccccccc2010	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
cd176f36-30a6-41cb-ad08-257abce35f0c	cccccccc-cccc-cccc-cccc-cccccccc2010	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
df9794da-867b-4351-952f-73ff4fcf39b3	cccccccc-cccc-cccc-cccc-cccccccc2010	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
e731e23f-59c5-4ce8-9cf2-d6c30e590e54	cccccccc-cccc-cccc-cccc-cccccccc2010	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
63ffdf16-90a3-4d04-af42-1d7613849258	cccccccc-cccc-cccc-cccc-cccccccc2010	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
492b7338-44fa-45ce-ac5e-bbc9d1716dcd	cccccccc-cccc-cccc-cccc-cccccccc2010	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
a3becca7-492a-4524-b984-cadf111cdc3d	cccccccc-cccc-cccc-cccc-cccccccc2010	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
191b846c-415d-4167-bc6d-6789017bbcdd	cccccccc-cccc-cccc-cccc-cccccccc2010	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
6ed4bef6-b2e0-4049-b931-3363a6e2f65a	cccccccc-cccc-cccc-cccc-cccccccc2010	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
15d47fd2-0340-42df-ad70-94913da476b0	cccccccc-cccc-cccc-cccc-cccccccc2010	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
88e54032-ad38-4a71-8e6e-0a5b8776c93c	cccccccc-cccc-cccc-cccc-cccccccc2010	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
9e3f2bbe-905b-4bd0-bf03-8032bb2db5fd	cccccccc-cccc-cccc-cccc-cccccccc2010	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
63cba674-970f-425c-8e08-e1a5a2c04009	cccccccc-cccc-cccc-cccc-cccccccc2010	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
ea54fb5e-5f2a-4a1a-b14b-6ea5ee612558	cccccccc-cccc-cccc-cccc-cccccccc2010	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
8eb6b91a-0139-4397-8683-a29aa07f7449	cccccccc-cccc-cccc-cccc-cccccccc2010	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
2d306629-1861-46ae-a9a1-b07ef8f56c8a	cccccccc-cccc-cccc-cccc-cccccccc2010	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
efe6d71f-8902-4e1d-b62a-f72815e474f6	cccccccc-cccc-cccc-cccc-cccccccc2010	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
2363f3f4-ca97-4263-8983-357b96e0dd1e	cccccccc-cccc-cccc-cccc-cccccccc2010	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
69e22c22-640a-4e37-90bb-8236ea9f5d89	cccccccc-cccc-cccc-cccc-cccccccc2010	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
779901e6-a7aa-41b9-8a4c-7ae56a5f6096	cccccccc-cccc-cccc-cccc-cccccccc2010	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
f908f947-049a-49e2-a96d-0946bac969bd	cccccccc-cccc-cccc-cccc-cccccccc2010	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
534ed294-1d84-4ed1-bc72-6fa42e987468	cccccccc-cccc-cccc-cccc-cccccccc2010	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
a09704a7-e17f-48f4-a057-2365fed7605f	cccccccc-cccc-cccc-cccc-cccccccc2010	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
2df11fe1-bdec-4eb0-b945-6b5ca673c3a7	cccccccc-cccc-cccc-cccc-cccccccc2010	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
3edb298d-377a-4ee6-b8a7-25f873403eb1	cccccccc-cccc-cccc-cccc-cccccccc2010	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
3e2c5f61-e8e5-4f38-b484-324ee50a358b	cccccccc-cccc-cccc-cccc-cccccccc2010	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
c2446759-5dca-4463-971b-d833b22c1942	cccccccc-cccc-cccc-cccc-cccccccc2010	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
99612f84-ddff-4597-8ff5-26b072311dd6	cccccccc-cccc-cccc-cccc-cccccccc2010	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
b3f91e74-7a50-447a-ab3d-63271c735e40	cccccccc-cccc-cccc-cccc-cccccccc2010	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
f1178446-3347-4037-ae4d-6c76f917f363	cccccccc-cccc-cccc-cccc-cccccccc2010	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
90ef9e54-0843-4148-9ecd-7ed8c5c72d04	cccccccc-cccc-cccc-cccc-cccccccc2010	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
807e425f-c12c-466e-bd18-e5d09a7690e1	cccccccc-cccc-cccc-cccc-cccccccc2010	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
3e186892-4e3b-425d-8246-1351df9b1c06	cccccccc-cccc-cccc-cccc-cccccccc2010	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
d1d01078-a8ca-48d0-af3b-e15e86ac070b	cccccccc-cccc-cccc-cccc-cccccccc2010	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
0ba6dd39-a27c-41d5-a81f-c99b7528ff58	cccccccc-cccc-cccc-cccc-cccccccc2010	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
48d2a5ad-424d-4c11-83e0-3fb28f30bd85	cccccccc-cccc-cccc-cccc-cccccccc2010	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
e4879f10-e2cc-4dcb-929c-68e65d3defc5	cccccccc-cccc-cccc-cccc-cccccccc2010	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
aa260012-2dbe-4299-bcb9-1d129c6e312a	cccccccc-cccc-cccc-cccc-cccccccc2010	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
1de7f469-f90f-4994-a7c3-41969061ff86	cccccccc-cccc-cccc-cccc-cccccccc2010	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
54e5ef40-f561-48d2-9db0-e1f5a2e8ae47	cccccccc-cccc-cccc-cccc-cccccccc2010	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
fc8aaf45-622d-4aa5-82cb-c10d46c46ae4	38795b48-5b66-4576-bfa8-1ea0223e57b1	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
7e94155a-1ac1-4de5-b0ac-deaef6dd1578	38795b48-5b66-4576-bfa8-1ea0223e57b1	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
b07df1e4-d11e-4b11-b2d7-41325329042d	38795b48-5b66-4576-bfa8-1ea0223e57b1	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
4976b7c7-c33d-4c28-9373-8c11069723ff	38795b48-5b66-4576-bfa8-1ea0223e57b1	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
ed66f903-9483-41a7-9e85-f7eb8ac252e5	38795b48-5b66-4576-bfa8-1ea0223e57b1	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
e02d4030-e895-4a7d-8bbe-691efd7388f0	38795b48-5b66-4576-bfa8-1ea0223e57b1	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
30417d60-db27-4ead-ac0b-6df5fdb52b28	38795b48-5b66-4576-bfa8-1ea0223e57b1	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
ee7cc510-f175-49b5-82d8-526bcc956e15	38795b48-5b66-4576-bfa8-1ea0223e57b1	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
377c2e83-9592-49ca-bfdf-495b538aca70	38795b48-5b66-4576-bfa8-1ea0223e57b1	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
8cefd40c-502e-4747-a673-07bb312d7ef9	38795b48-5b66-4576-bfa8-1ea0223e57b1	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
f2b10747-6486-43aa-9693-e45a573f1ddf	38795b48-5b66-4576-bfa8-1ea0223e57b1	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
d5ba73ae-92d5-4a50-a46b-52da97d236ae	38795b48-5b66-4576-bfa8-1ea0223e57b1	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
a061a1ff-07ac-41e7-9d84-2644faec9fd3	38795b48-5b66-4576-bfa8-1ea0223e57b1	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
7db6baa1-f4e7-4bde-84f7-2aa1ac22906c	38795b48-5b66-4576-bfa8-1ea0223e57b1	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
624d86f1-754a-4025-af99-07b3058cd673	38795b48-5b66-4576-bfa8-1ea0223e57b1	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
bf354220-ca88-4a2b-8010-9bdae603f357	38795b48-5b66-4576-bfa8-1ea0223e57b1	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
63135668-6fad-464b-a687-97833984440f	38795b48-5b66-4576-bfa8-1ea0223e57b1	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
9e5ad614-1a18-4ee6-8b16-3c9ac5ffdbe9	38795b48-5b66-4576-bfa8-1ea0223e57b1	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
4f0de716-c88c-4fc2-a27a-5b27bfb626cd	38795b48-5b66-4576-bfa8-1ea0223e57b1	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
90563a98-1591-4f30-b38e-ff3ba9415f34	38795b48-5b66-4576-bfa8-1ea0223e57b1	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
0db719cb-8119-4700-ba2e-40ef6d126d6a	38795b48-5b66-4576-bfa8-1ea0223e57b1	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
05ddb48a-ea11-4217-b6f0-b574a1d3aaae	38795b48-5b66-4576-bfa8-1ea0223e57b1	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
6d8cd4c3-b352-43b0-9839-29963b459f5f	38795b48-5b66-4576-bfa8-1ea0223e57b1	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
ffd94867-f227-4f78-8943-696008ef2a46	38795b48-5b66-4576-bfa8-1ea0223e57b1	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
bcc2df68-9c21-4067-a23d-c4bfedcc76ab	38795b48-5b66-4576-bfa8-1ea0223e57b1	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
d9f527a2-f540-4a10-b14e-ab9f5106170f	38795b48-5b66-4576-bfa8-1ea0223e57b1	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
aed5a783-bc44-43be-8f7b-868165ca8b93	38795b48-5b66-4576-bfa8-1ea0223e57b1	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
b5e81468-088b-4d70-bb0c-72c5cf38d29c	38795b48-5b66-4576-bfa8-1ea0223e57b1	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
be7c5041-1a50-4ebc-8921-a1e0fd55fd6d	38795b48-5b66-4576-bfa8-1ea0223e57b1	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
61c09d5d-49ba-4567-b999-d4d3ebd1a1d3	38795b48-5b66-4576-bfa8-1ea0223e57b1	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
b218c3ce-da50-4f07-9dc7-971310bb8301	38795b48-5b66-4576-bfa8-1ea0223e57b1	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
38d16fc3-7f32-4539-be06-74eb3b4f5b1a	38795b48-5b66-4576-bfa8-1ea0223e57b1	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
07349683-e347-401f-b6b0-cf9977b2712c	38795b48-5b66-4576-bfa8-1ea0223e57b1	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
a86e3808-03ca-4487-9591-179e5f918309	38795b48-5b66-4576-bfa8-1ea0223e57b1	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
d471beb5-2a77-4a63-abf3-a99e31d4f9f3	38795b48-5b66-4576-bfa8-1ea0223e57b1	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
847f8f9e-6961-4eeb-a9cb-e1546102bf29	38795b48-5b66-4576-bfa8-1ea0223e57b1	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
c749ac65-a6f5-43b4-af73-7e398252a248	38795b48-5b66-4576-bfa8-1ea0223e57b1	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
71699746-935e-466f-9782-7cdf59a10c63	38795b48-5b66-4576-bfa8-1ea0223e57b1	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
8500cdb4-ed08-4b85-bb32-c0e92cf3a067	38795b48-5b66-4576-bfa8-1ea0223e57b1	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
99833680-11f3-40ad-93cd-a5ca2e4808b3	38795b48-5b66-4576-bfa8-1ea0223e57b1	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
a430834a-7d4d-40c4-b83c-3605ff5db6a1	38795b48-5b66-4576-bfa8-1ea0223e57b1	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
48c0c58b-b37d-49d2-8e8b-526c7f0bf0ed	38795b48-5b66-4576-bfa8-1ea0223e57b1	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
7148903b-28a9-409f-9766-792e96d5a6fe	38795b48-5b66-4576-bfa8-1ea0223e57b1	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
34a4a94f-ad8c-4cec-80ea-e054bcaf5968	38795b48-5b66-4576-bfa8-1ea0223e57b1	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
34f59770-87d9-4f26-be39-a0212843492a	38795b48-5b66-4576-bfa8-1ea0223e57b1	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
acd44bb7-d813-4350-9524-81876fe73c3d	38795b48-5b66-4576-bfa8-1ea0223e57b1	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
8d67f29e-d79a-4eae-b03d-212b1c5e15a3	38795b48-5b66-4576-bfa8-1ea0223e57b1	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
1b57338c-78cf-4ff3-b094-3b5492393949	38795b48-5b66-4576-bfa8-1ea0223e57b1	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
e513295e-ee31-41a9-bc8e-ef72ad379c6b	38795b48-5b66-4576-bfa8-1ea0223e57b1	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
00402f7f-2b78-4036-ac1a-7b8819b1f0e2	38795b48-5b66-4576-bfa8-1ea0223e57b1	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
1e74739c-eb1d-4c83-919f-08f24201b27f	cccccccc-cccc-cccc-cccc-cccccccc2003	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
2787c858-b1b2-4190-9300-0385e4c8fbac	cccccccc-cccc-cccc-cccc-cccccccc2003	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
e55e48fc-a110-4130-ab72-5b0c34baaeed	cccccccc-cccc-cccc-cccc-cccccccc2003	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
1d1c440e-3608-44bf-8072-90e6a9e4ebcf	cccccccc-cccc-cccc-cccc-cccccccc2003	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
0ed91d61-c3ef-4079-af09-d5d11781f1a5	cccccccc-cccc-cccc-cccc-cccccccc2003	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
a35f5e24-d79d-4c47-9c38-e33cfef451de	cccccccc-cccc-cccc-cccc-cccccccc2003	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
35e761aa-9843-42a4-8dda-cf1c699f6166	cccccccc-cccc-cccc-cccc-cccccccc2003	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
d19900fa-bef3-4b0c-a649-2e4e79e3eca1	cccccccc-cccc-cccc-cccc-cccccccc2003	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
77c97ac8-38bc-4052-ae9f-ad98f5d443cf	cccccccc-cccc-cccc-cccc-cccccccc2003	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
7374165b-40d2-4473-b73d-03d6283530bf	cccccccc-cccc-cccc-cccc-cccccccc2003	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
cc9ee4ef-6a0f-44c1-a855-e97be2693838	cccccccc-cccc-cccc-cccc-cccccccc2003	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
d6236001-7123-4e7b-b75c-8cdd993111b1	cccccccc-cccc-cccc-cccc-cccccccc2003	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
93f3c96d-910c-4bb0-b327-9239ee1a29b1	cccccccc-cccc-cccc-cccc-cccccccc2003	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
0cd66c96-b7f1-404b-a6bf-83ddcc6adb35	cccccccc-cccc-cccc-cccc-cccccccc2003	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
bc049a35-4820-4715-9bc7-cdeeea480e5d	cccccccc-cccc-cccc-cccc-cccccccc2003	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
e29f21d8-e937-4ce7-b8f3-9117b39a1835	cccccccc-cccc-cccc-cccc-cccccccc2003	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
73d07908-ab2d-4574-a14e-28e6c2ed3c27	cccccccc-cccc-cccc-cccc-cccccccc2003	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
4873e092-7676-4b73-98c2-deec1a54b1da	cccccccc-cccc-cccc-cccc-cccccccc2003	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
76afa27c-5d4d-4ffd-8cce-a4aa78359b65	cccccccc-cccc-cccc-cccc-cccccccc2003	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
90e7a431-e153-4ba1-86fd-58dbd19237aa	cccccccc-cccc-cccc-cccc-cccccccc2003	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
d6c1d027-73f2-47bb-9f84-226bd85e2fa3	cccccccc-cccc-cccc-cccc-cccccccc2003	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
46ea8fce-277f-4571-aa96-1f4fceb65dbd	cccccccc-cccc-cccc-cccc-cccccccc2003	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
b0b6193a-fca0-46e2-9232-1cacd39f1eaa	cccccccc-cccc-cccc-cccc-cccccccc2003	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
f82a522b-6901-4c01-90ed-4d9bd392ada6	cccccccc-cccc-cccc-cccc-cccccccc2003	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
7956aa50-625a-4271-b116-5a487f471c01	cccccccc-cccc-cccc-cccc-cccccccc2003	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
3b879657-680c-4239-822c-1bbf27681f11	cccccccc-cccc-cccc-cccc-cccccccc2003	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
a60af79f-9258-407c-914e-d997f2f1a95f	cccccccc-cccc-cccc-cccc-cccccccc2003	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
649ecbae-4457-4595-8c9f-13740bbeb45f	cccccccc-cccc-cccc-cccc-cccccccc2003	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
4d45b45c-7eeb-4e3c-ab55-cc479170de0f	cccccccc-cccc-cccc-cccc-cccccccc2003	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
b8195e51-116c-4167-afbb-32db2b731073	cccccccc-cccc-cccc-cccc-cccccccc2003	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
b8d92372-fa62-4466-86fe-f3cd7d680f33	cccccccc-cccc-cccc-cccc-cccccccc2003	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
f67bda70-3497-4099-ae6d-aa5aeb80f45b	cccccccc-cccc-cccc-cccc-cccccccc2003	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
d1a85656-76d8-40cb-939d-3d57759c6de6	cccccccc-cccc-cccc-cccc-cccccccc2003	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
6dbf359f-f89a-4066-a239-42f58ff37606	cccccccc-cccc-cccc-cccc-cccccccc2003	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
24671e31-d451-4499-92f2-1abbb01aa452	cccccccc-cccc-cccc-cccc-cccccccc2003	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
e8eb400c-c771-4bdb-8799-fa42b595603c	cccccccc-cccc-cccc-cccc-cccccccc2003	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
c1a027f3-7f6b-4a99-b475-3d4c0a762e92	cccccccc-cccc-cccc-cccc-cccccccc2003	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
123eeb62-f368-4107-887a-664dbefb8e76	cccccccc-cccc-cccc-cccc-cccccccc2003	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
3d0a0f2e-75ea-454b-b7d1-789d59c5dbdc	cccccccc-cccc-cccc-cccc-cccccccc2003	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
5b31c701-bb01-454a-ad00-559ea187a365	cccccccc-cccc-cccc-cccc-cccccccc2003	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
b710c64b-53ec-47de-b34b-c085d0fa883b	cccccccc-cccc-cccc-cccc-cccccccc2003	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
e4883cbf-b199-4be8-89e2-1248e851eeb0	cccccccc-cccc-cccc-cccc-cccccccc2003	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
92e6bee5-628f-4041-86c7-a4e127c2b7d4	cccccccc-cccc-cccc-cccc-cccccccc2003	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
e8e093a3-50a2-4b43-836e-4a587b607b1e	cccccccc-cccc-cccc-cccc-cccccccc2003	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
31d6a8e6-0ece-41cf-9124-414921fb4611	cccccccc-cccc-cccc-cccc-cccccccc2003	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
61f986ec-8aaf-408b-b9bf-dcff2f184a10	cccccccc-cccc-cccc-cccc-cccccccc2003	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
f8453b42-0370-48e8-ba5f-b62325ef1f27	cccccccc-cccc-cccc-cccc-cccccccc2003	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
6f514ed1-11e4-451c-85dc-29e0289c4a50	cccccccc-cccc-cccc-cccc-cccccccc2003	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
e4ed3909-b086-4ad9-babf-60428f9611fb	cccccccc-cccc-cccc-cccc-cccccccc2003	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
4a935aa2-e635-49c5-a3b2-695f0a2daab7	cccccccc-cccc-cccc-cccc-cccccccc2003	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
3eddeada-732c-4d7d-a92a-253e1766c184	cccccccc-cccc-cccc-cccc-cccccccc2004	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
2ba31de8-59eb-4540-aa67-18089129714c	cccccccc-cccc-cccc-cccc-cccccccc2004	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
694a3020-b7d5-4ff4-9c8c-4e692aabc3c3	cccccccc-cccc-cccc-cccc-cccccccc2004	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
9156c9c6-b739-4ef5-a62f-d82d00f6d8a9	cccccccc-cccc-cccc-cccc-cccccccc2004	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
b44ae364-02bb-48b4-9614-4a0d5536616b	cccccccc-cccc-cccc-cccc-cccccccc2004	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
a19e1c16-7376-4b7a-b7dd-727aa586b135	cccccccc-cccc-cccc-cccc-cccccccc2004	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
4bacb5ac-bf01-499a-b0b6-7f11d7564e0a	cccccccc-cccc-cccc-cccc-cccccccc2004	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
588dad7d-6039-4ca4-95d9-4d5abbc92ba1	cccccccc-cccc-cccc-cccc-cccccccc2004	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
4608c96a-3af8-43f0-bb50-93ffa4c3bfbe	cccccccc-cccc-cccc-cccc-cccccccc2004	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
88015f7d-5a6e-4b3a-8ec9-f76ab96fc147	cccccccc-cccc-cccc-cccc-cccccccc2004	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
15dfcb36-4f02-474f-b121-420d3c71f5d3	cccccccc-cccc-cccc-cccc-cccccccc2004	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
03122683-6e2d-4481-a307-eaa033f558c5	cccccccc-cccc-cccc-cccc-cccccccc2004	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
530246cf-5e9d-455f-a982-cb98ebeb946c	cccccccc-cccc-cccc-cccc-cccccccc2004	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
99f9325c-cd26-4edb-9723-d1f279000eda	cccccccc-cccc-cccc-cccc-cccccccc2004	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
d81d7561-02df-437d-9fdd-8d628f3d9b6c	cccccccc-cccc-cccc-cccc-cccccccc2004	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
3691530c-6257-44da-937a-1849a118ddbc	cccccccc-cccc-cccc-cccc-cccccccc2004	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
704dd594-6d42-4153-9b39-42a720db1f2d	cccccccc-cccc-cccc-cccc-cccccccc2004	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
d6f78e30-1dff-4ed4-8c2d-486b7057e46f	cccccccc-cccc-cccc-cccc-cccccccc2004	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
b9b59a44-6db7-41f1-b45d-e383841b2618	cccccccc-cccc-cccc-cccc-cccccccc2004	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
106dcdfe-6081-4d0d-aef7-e60f20fd2233	cccccccc-cccc-cccc-cccc-cccccccc2004	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
f1253aa0-4ccf-4ee3-abd6-408016119dec	cccccccc-cccc-cccc-cccc-cccccccc2004	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
3d825cbc-6fca-4e2d-8c82-c550be866f1b	cccccccc-cccc-cccc-cccc-cccccccc2004	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
e08d8d42-f642-48de-ba76-ad54a6b4f099	cccccccc-cccc-cccc-cccc-cccccccc2004	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
db0a174a-91ab-4a09-9fd9-baacf15f8842	cccccccc-cccc-cccc-cccc-cccccccc2004	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
2da03786-775e-4a73-a2c1-a9b216e73fa7	cccccccc-cccc-cccc-cccc-cccccccc2004	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
0fafcd1d-0006-4422-90d5-58f9ff24c887	cccccccc-cccc-cccc-cccc-cccccccc2004	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
a6ce865e-84e3-4456-9fad-20e39561379d	cccccccc-cccc-cccc-cccc-cccccccc2004	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
d30c9269-aec3-42a8-bf8f-868cffddd16f	cccccccc-cccc-cccc-cccc-cccccccc2004	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
d4f03ecc-a640-4e10-8f1f-bbd7dc83b016	cccccccc-cccc-cccc-cccc-cccccccc2004	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
d4524303-3285-4ed0-86b6-6cad5890c0f2	cccccccc-cccc-cccc-cccc-cccccccc2004	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
ce8ef439-bffc-43dc-9347-12b54d3bb059	cccccccc-cccc-cccc-cccc-cccccccc2004	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
8b94a946-059c-40ea-a382-bda67638618f	cccccccc-cccc-cccc-cccc-cccccccc2004	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
5d84ccb5-69dd-4da2-8541-478bc067821c	cccccccc-cccc-cccc-cccc-cccccccc2004	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
5290bbd9-62b1-4c06-9592-cc4b2bde7fe8	cccccccc-cccc-cccc-cccc-cccccccc2004	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
9ad38000-3b81-4852-808c-50612b824eb3	cccccccc-cccc-cccc-cccc-cccccccc2004	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
da248604-7169-48c5-bb18-d4e980aa25a2	cccccccc-cccc-cccc-cccc-cccccccc2004	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
41b7e1e2-50f4-48ba-91af-7a22940bfc5f	cccccccc-cccc-cccc-cccc-cccccccc2004	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
b7881f99-1122-4aee-ba80-958662916259	cccccccc-cccc-cccc-cccc-cccccccc2004	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
e2c2836e-4ff7-449f-bcd8-a30c502eb79a	cccccccc-cccc-cccc-cccc-cccccccc2004	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
3892c854-7ffd-4524-91f0-3f2181ee165b	cccccccc-cccc-cccc-cccc-cccccccc2004	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
7b2e52a7-6055-4398-9737-230907c35912	cccccccc-cccc-cccc-cccc-cccccccc2004	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
78713166-4cd9-4443-a9e0-21a68a2e0881	cccccccc-cccc-cccc-cccc-cccccccc2004	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
3286d0c1-0c1f-46fb-960f-e4597feede00	cccccccc-cccc-cccc-cccc-cccccccc2004	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
b6a726ce-d1d4-4d00-8649-661a9183ca12	cccccccc-cccc-cccc-cccc-cccccccc2004	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
56ca8343-62fe-4298-8f99-72e7b11610d2	cccccccc-cccc-cccc-cccc-cccccccc2004	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
26099858-0f4b-4930-a878-0dc5cf296611	cccccccc-cccc-cccc-cccc-cccccccc2004	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
436ee351-fc1e-4d52-a843-8da2dd7b44e8	cccccccc-cccc-cccc-cccc-cccccccc2004	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
362b4596-63e1-48aa-9a92-b4b20ddb7396	cccccccc-cccc-cccc-cccc-cccccccc2004	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
3c74aa9c-910d-442f-bc11-62a598c52480	cccccccc-cccc-cccc-cccc-cccccccc2004	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
dee01fbc-556e-4287-ad63-986ee8089e8b	cccccccc-cccc-cccc-cccc-cccccccc2004	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
893880ed-d67c-4e04-94a5-8d8beeb48351	cccccccc-cccc-cccc-cccc-cccccccc2002	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-02 21:49:49.811597+00
7ad502c7-a15d-4ff6-a87b-b4d7ce7a7801	cccccccc-cccc-cccc-cccc-cccccccc2002	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-02 21:49:49.811597+00
2cf49acf-dbf2-438d-ad5e-82fd079d2e2a	cccccccc-cccc-cccc-cccc-cccccccc2002	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-02 21:49:49.811597+00
43b4656c-88b9-4840-9546-ab28807725b2	cccccccc-cccc-cccc-cccc-cccccccc2002	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-02 21:49:49.811597+00
5871eb65-19a5-4cb2-8e15-3faf75e0c1dc	cccccccc-cccc-cccc-cccc-cccccccc2002	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-02 21:49:49.811597+00
2213402f-9e98-49d6-b278-5fe8048aa6cb	cccccccc-cccc-cccc-cccc-cccccccc2002	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-02 21:49:49.811597+00
fc8c6630-6909-4619-b34f-febc5f2902dc	cccccccc-cccc-cccc-cccc-cccccccc2002	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-02 21:49:49.811597+00
0159d83c-af8b-4168-91e8-8b86be310ad8	cccccccc-cccc-cccc-cccc-cccccccc2002	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-02 21:49:49.811597+00
8b9caa53-f74b-4cf6-a870-6166087d840f	cccccccc-cccc-cccc-cccc-cccccccc2002	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-02 21:49:49.811597+00
e12ab688-8a48-41df-8d4c-823cb0c50a2f	cccccccc-cccc-cccc-cccc-cccccccc2002	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-02 21:49:49.811597+00
aaf208cc-7f7c-43fa-bc41-c29150232418	cccccccc-cccc-cccc-cccc-cccccccc2002	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-02 21:49:49.811597+00
692a527e-3fa8-4a7a-810b-2f1f8b8a58a3	cccccccc-cccc-cccc-cccc-cccccccc2002	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-02 21:49:49.811597+00
1709ff05-f5b5-4353-a595-09b0b15a5b46	cccccccc-cccc-cccc-cccc-cccccccc2002	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-02 21:49:49.811597+00
4a1abbe9-fcf6-4d4f-8376-a3780f13e0c3	cccccccc-cccc-cccc-cccc-cccccccc2002	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-02 21:49:49.811597+00
ee854468-d44e-4a82-b13b-967f56078402	cccccccc-cccc-cccc-cccc-cccccccc2002	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-02 21:49:49.811597+00
a6a666ab-bc13-44f7-a82d-ddf8b81102c0	cccccccc-cccc-cccc-cccc-cccccccc2002	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-02 21:49:49.811597+00
fb0eabaa-3e55-4acf-b647-ecf63782c91e	cccccccc-cccc-cccc-cccc-cccccccc2002	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-02 21:49:49.811597+00
f9be8c7b-960b-4c22-b753-a8a326e96c54	cccccccc-cccc-cccc-cccc-cccccccc2002	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-02 21:49:49.811597+00
29e02cf3-bc72-4f71-b12e-3b8782b92a00	cccccccc-cccc-cccc-cccc-cccccccc2002	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-02 21:49:49.811597+00
20b6b1dc-d55d-4af7-941f-79d672fa4c35	cccccccc-cccc-cccc-cccc-cccccccc2002	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-02 21:49:49.811597+00
3e728ae2-16a5-43e3-a049-3cfb30e44f06	cccccccc-cccc-cccc-cccc-cccccccc2002	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-02 21:49:49.811597+00
d54b79c0-4dc1-4a55-9cb6-2a8409bbcd75	cccccccc-cccc-cccc-cccc-cccccccc2002	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-02 21:49:49.811597+00
6d5825e2-5a77-4058-9cf9-09df8e119f42	cccccccc-cccc-cccc-cccc-cccccccc2002	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-02 21:49:49.811597+00
306167c0-7f4f-4e8c-97e1-946e8aebe78a	cccccccc-cccc-cccc-cccc-cccccccc2002	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-02 21:49:49.811597+00
9e36c2d5-86fb-49c1-be02-378a7ac0dfa3	cccccccc-cccc-cccc-cccc-cccccccc2002	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-02 21:49:49.811597+00
1a57ae4c-1b29-49c3-87f7-648598d02772	cccccccc-cccc-cccc-cccc-cccccccc2002	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-02 21:49:49.811597+00
7ee84ce9-5f28-4dd2-981f-68ac1fd38ab4	cccccccc-cccc-cccc-cccc-cccccccc2002	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-02 21:49:49.811597+00
a4a15ecb-6b57-40ee-9763-1d72c27205ac	cccccccc-cccc-cccc-cccc-cccccccc2002	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-02 21:49:49.811597+00
95548d88-cf6f-4271-9f29-22f32d0820b1	cccccccc-cccc-cccc-cccc-cccccccc2002	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-02 21:49:49.811597+00
50ce5489-fca7-4589-abe9-6efaef16bb17	cccccccc-cccc-cccc-cccc-cccccccc2002	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-02 21:49:49.811597+00
6fbd3e1b-e31e-4f07-907f-5a7439479feb	cccccccc-cccc-cccc-cccc-cccccccc2002	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-02 21:49:49.811597+00
dcc4100f-e771-4179-abe6-69834b798a0d	cccccccc-cccc-cccc-cccc-cccccccc2002	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-02 21:49:49.811597+00
06e3b4d2-6514-4312-9417-29385d0e4886	cccccccc-cccc-cccc-cccc-cccccccc2002	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-02 21:49:49.811597+00
c224e78f-d5f6-4b59-a360-2b6019d30848	cccccccc-cccc-cccc-cccc-cccccccc2002	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-02 21:49:49.811597+00
b46b405f-49f3-4174-924b-f704327b5d88	cccccccc-cccc-cccc-cccc-cccccccc2002	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-02 21:49:49.811597+00
4d693493-565a-4327-8f88-dfe38fbde87c	cccccccc-cccc-cccc-cccc-cccccccc2002	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-02 21:49:49.811597+00
d9a483dc-4869-4a61-bf7f-349587d42529	cccccccc-cccc-cccc-cccc-cccccccc2002	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-02 21:49:49.811597+00
4561521c-d81b-4484-8e1b-68e12331898d	cccccccc-cccc-cccc-cccc-cccccccc2002	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-02 21:49:49.811597+00
98511ca3-54a4-4da1-bb21-dfeccfc26175	cccccccc-cccc-cccc-cccc-cccccccc2002	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-02 21:49:49.811597+00
2a01e6de-61a1-4c43-a40b-61908be164b5	cccccccc-cccc-cccc-cccc-cccccccc2002	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-02 21:49:49.811597+00
a4b405b1-edcf-48dd-9b1e-ea3b4969af13	cccccccc-cccc-cccc-cccc-cccccccc2002	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-02 21:49:49.811597+00
ac1e17e3-4bf2-4cbf-8de3-25eb9a8308cc	cccccccc-cccc-cccc-cccc-cccccccc2002	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-02 21:49:49.811597+00
5e3f809f-a201-44fb-bc4f-fdf938633f92	cccccccc-cccc-cccc-cccc-cccccccc2002	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-02 21:49:49.811597+00
3cbccba4-2ace-4f5d-a0c5-17905c7cc1e2	cccccccc-cccc-cccc-cccc-cccccccc2002	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-02 21:49:49.811597+00
49cacf52-6da6-4a4d-a523-d049f5650dd6	cccccccc-cccc-cccc-cccc-cccccccc2002	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-02 21:49:49.811597+00
d1b00225-5518-4aa3-9614-1cb05b976c82	cccccccc-cccc-cccc-cccc-cccccccc2002	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-02 21:49:49.811597+00
7993f65a-3c57-4c55-a470-d47e19ce8cd5	cccccccc-cccc-cccc-cccc-cccccccc2002	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-02 21:49:49.811597+00
8ea0354b-d775-4aca-aa92-576b7e06531d	cccccccc-cccc-cccc-cccc-cccccccc2002	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-02 21:49:49.811597+00
f7b82ac3-066f-41c8-96b0-54216d21b7ca	cccccccc-cccc-cccc-cccc-cccccccc2002	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-02 21:49:49.811597+00
df4920e4-ce81-40e3-96b0-a24e6e79bdbb	cccccccc-cccc-cccc-cccc-cccccccc2002	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-02 21:49:49.811597+00
f214b9e4-74d3-4702-982c-40b5d951be9b	11111111-1111-1111-1111-111111111020	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:09.62241+00
278211e4-339c-4a8b-a448-efcca33afe55	11111111-1111-1111-1111-111111111020	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:09.62241+00
d325d6b7-564e-46df-b949-357fff1fc3d6	11111111-1111-1111-1111-111111111020	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:09.62241+00
7e138529-c13c-4ea6-b933-45c3e81e87fb	11111111-1111-1111-1111-111111111020	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:09.62241+00
4bc594fe-18d8-44b2-ad86-f69d715640d0	11111111-1111-1111-1111-111111111020	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:09.62241+00
c9fe1fea-8591-42ec-93cd-aa119bb21678	11111111-1111-1111-1111-111111111020	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:09.62241+00
3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	11111111-1111-1111-1111-111111111020	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:09.62241+00
4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	11111111-1111-1111-1111-111111111020	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:09.62241+00
e4406d81-f759-4171-9783-b6921bb2aac0	11111111-1111-1111-1111-111111111020	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:09.62241+00
d1c80a85-50d5-4b2c-b39f-6e7e62e70836	11111111-1111-1111-1111-111111111020	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:09.62241+00
5e4564a0-33c5-4682-8d23-2d15d8515b45	11111111-1111-1111-1111-111111111020	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:09.62241+00
b7019767-d2b1-41d3-9348-1882e3118cfb	11111111-1111-1111-1111-111111111020	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:09.62241+00
a57df58a-8cdb-446c-a741-490e1c07307f	11111111-1111-1111-1111-111111111020	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:09.62241+00
bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	11111111-1111-1111-1111-111111111020	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:09.62241+00
1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	11111111-1111-1111-1111-111111111020	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:09.62241+00
c85a8f16-759e-40b9-9158-2b4d66c497cb	11111111-1111-1111-1111-111111111020	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:09.62241+00
49e93d72-84f2-436b-aefa-e63eb1108a61	11111111-1111-1111-1111-111111111020	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:09.62241+00
020c801a-be94-44fb-987a-8b71d2a5faa9	11111111-1111-1111-1111-111111111020	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:09.62241+00
49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	11111111-1111-1111-1111-111111111020	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:09.62241+00
32851994-90c8-46f1-ae9f-df99830b56b5	11111111-1111-1111-1111-111111111020	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:09.62241+00
30ee0b44-cdba-4bbe-a30c-347cd393eed1	11111111-1111-1111-1111-111111111020	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:09.62241+00
8d355c2a-1fd0-48c0-8195-922fce9e1b7d	11111111-1111-1111-1111-111111111020	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:09.62241+00
08f6c270-1667-4635-9494-b1f31ddbf21e	11111111-1111-1111-1111-111111111020	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:09.62241+00
efa02eb3-6e98-4010-bb1f-5c401bb754d2	11111111-1111-1111-1111-111111111020	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:09.62241+00
61e9581e-9948-4406-a037-b8a3c5a44854	11111111-1111-1111-1111-111111111020	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:09.62241+00
1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	11111111-1111-1111-1111-111111111020	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:09.62241+00
b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	11111111-1111-1111-1111-111111111020	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:09.62241+00
32d9ce60-90ea-4728-95bf-4e00e01103dc	11111111-1111-1111-1111-111111111020	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:09.62241+00
b5017f83-9c68-4824-ad35-481f48085589	11111111-1111-1111-1111-111111111020	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:09.62241+00
09611139-e4a6-4690-8547-4b9f597948d5	11111111-1111-1111-1111-111111111020	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:09.62241+00
6708cca7-6416-45c6-84d4-fad93d09dc67	11111111-1111-1111-1111-111111111020	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:09.62241+00
a667bfa7-869f-4097-b2ea-a579617f2891	11111111-1111-1111-1111-111111111020	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:09.62241+00
37a36fda-b2c4-41e4-aa06-031a4c2717f8	11111111-1111-1111-1111-111111111020	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:09.62241+00
8a2a99f3-7f53-4098-a815-c36e4f63db8a	11111111-1111-1111-1111-111111111020	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:09.62241+00
c0b474aa-0311-4eda-8b4b-85d41965e0ca	11111111-1111-1111-1111-111111111020	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:09.62241+00
fb6ded29-0e78-4e05-8db0-eeefa3c76144	11111111-1111-1111-1111-111111111020	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:09.62241+00
5770d367-fead-49c9-8d2d-2c272f24067e	11111111-1111-1111-1111-111111111020	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:09.62241+00
886c8b7a-42bd-4aef-9d14-de197ae41c10	11111111-1111-1111-1111-111111111020	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:09.62241+00
fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	11111111-1111-1111-1111-111111111020	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:09.62241+00
7a635620-d5af-4403-8ea2-1efbc61900a0	11111111-1111-1111-1111-111111111020	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:09.62241+00
fbe80075-8a2c-47d8-a5e0-72e542ff6531	11111111-1111-1111-1111-111111111020	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:09.62241+00
6febb11f-21d1-41ef-a1bc-ee814c70aea0	11111111-1111-1111-1111-111111111020	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:09.62241+00
0be4464d-c3dd-4048-9fda-5cd4e5b71630	11111111-1111-1111-1111-111111111020	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:09.62241+00
77e1f23a-e5bb-43da-a708-8ef4fef087ed	11111111-1111-1111-1111-111111111020	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:09.62241+00
1a829301-36f0-49ea-880f-0bca7de67a1c	11111111-1111-1111-1111-111111111020	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:09.62241+00
8ae04766-4a38-4bd0-94d3-5ba64f40c666	11111111-1111-1111-1111-111111111020	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:09.62241+00
ada98e81-f09f-436c-b7a3-1350b0bb7c59	11111111-1111-1111-1111-111111111020	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:09.62241+00
16528ff5-e872-43c8-9df5-96a02e4787c3	11111111-1111-1111-1111-111111111020	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:09.62241+00
b01bf0cf-854e-422d-9d30-844098249d86	11111111-1111-1111-1111-111111111020	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:09.62241+00
ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	11111111-1111-1111-1111-111111111020	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:09.62241+00
afccdda9-0c5b-4076-a854-0eed7b2f8878	898162b4-0df4-41c0-b660-08ae42921b5f	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
c21985f2-5847-4d0f-b191-9b1f5c2da8fc	30b0db18-fb03-416d-9789-aff8abaaff0b	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
46c71f09-1baa-430f-94dd-746f17f92a6a	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
767f1b1d-3d8a-41a5-bfbd-01108aa23994	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
c2b37f35-8c4d-4227-a1be-c8709f21a780	1a195567-49ff-43de-8d82-f39ee3c6f52a	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
527963b2-f5b6-42e2-8341-6e0451fb2304	db78b658-294e-4cd9-9311-b92195697fb0	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
b879c8f7-af1c-495b-a497-fa40a648906c	a18c3be8-6893-4232-8ffa-e61f84049496	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
78c1addb-677d-4691-8146-3e44a07fb1c3	93559c7b-1836-48c5-bd6d-cd895e547b6e	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
398b828b-9569-4317-a638-758b646ac419	d93d219a-610d-42f5-a5c9-d6d355b236f2	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 00:55:11.014189+00
0520d48d-ae48-4153-ac3a-f66670ba847a	898162b4-0df4-41c0-b660-08ae42921b5f	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
536fbaca-a456-4990-8ca4-9b398344ec25	30b0db18-fb03-416d-9789-aff8abaaff0b	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
65c9cb7f-497f-4e8e-90fe-d84891d592d9	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
b96e7b82-347c-4ca1-aba0-c60be6fac257	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
d63ac474-02ce-4cc6-88e1-506026021307	1a195567-49ff-43de-8d82-f39ee3c6f52a	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
3013ade5-aa13-417c-8a35-aa28007f9758	db78b658-294e-4cd9-9311-b92195697fb0	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
b8b1c5b5-3339-46aa-89cc-f6622abb61fc	a18c3be8-6893-4232-8ffa-e61f84049496	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
5e491417-a258-4584-867c-bee78ec16707	93559c7b-1836-48c5-bd6d-cd895e547b6e	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
cad85e79-85c1-4fd7-ac88-456ddfd30157	d93d219a-610d-42f5-a5c9-d6d355b236f2	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 00:55:11.014189+00
76fab86f-a762-49a3-8db6-00211de33693	898162b4-0df4-41c0-b660-08ae42921b5f	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
466b09af-d8ac-488a-ab73-96c824e049bc	30b0db18-fb03-416d-9789-aff8abaaff0b	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
e15338d1-2df5-48bc-b460-7326e8ebfdf6	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
0247259a-4a99-4bb5-958d-d02fa532cf5a	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
337786dc-a5f7-410c-b307-7d909d3e08a1	1a195567-49ff-43de-8d82-f39ee3c6f52a	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
a0085112-5ba6-41c5-ac06-ae04955cfe3d	db78b658-294e-4cd9-9311-b92195697fb0	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
27b32aea-26ff-40b2-8a5f-c17a7ad9d061	a18c3be8-6893-4232-8ffa-e61f84049496	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
cb71fd7a-798b-43db-b82e-fa371cb08873	93559c7b-1836-48c5-bd6d-cd895e547b6e	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
8ad486c7-c84e-41a5-9576-341be1372e0e	d93d219a-610d-42f5-a5c9-d6d355b236f2	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 00:55:11.014189+00
2d137f23-d781-4d4b-b63e-7bef1c0c4f3c	898162b4-0df4-41c0-b660-08ae42921b5f	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
09ace2e1-a3c5-4e45-9324-487177b91686	30b0db18-fb03-416d-9789-aff8abaaff0b	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
8e0474c1-315b-48e6-a113-b881174abaaf	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
667b182b-5426-4b1e-b4cd-1f508cf7596a	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
61213f05-b4f7-46f9-98f5-895fc88d0ba4	1a195567-49ff-43de-8d82-f39ee3c6f52a	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
bf954863-964f-4019-9606-38d0936c7525	db78b658-294e-4cd9-9311-b92195697fb0	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
84de5737-8962-4523-94c2-87fbcab4564d	a18c3be8-6893-4232-8ffa-e61f84049496	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
e34b1eee-481e-4f69-ac24-c439ec65459b	93559c7b-1836-48c5-bd6d-cd895e547b6e	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
1027772e-49a3-4d20-9b76-0a9e65569b40	d93d219a-610d-42f5-a5c9-d6d355b236f2	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 00:55:11.014189+00
46ea7e5e-fb3a-4dd2-9fb1-5375097f8efa	898162b4-0df4-41c0-b660-08ae42921b5f	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
fa5bf81b-1c53-47a4-8356-d146a86625c2	30b0db18-fb03-416d-9789-aff8abaaff0b	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
40187556-21b4-4bbf-8db9-e58c99e27738	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
0466d4e0-12e8-49f3-8694-f7e73bf4b944	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
4ce48b3d-250f-471e-b927-94f3e4c65e15	1a195567-49ff-43de-8d82-f39ee3c6f52a	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
72c01d3d-2f4c-4eae-a6b5-46c93f68cf75	db78b658-294e-4cd9-9311-b92195697fb0	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
15d58478-9a52-4c75-a9a6-c5b0192ca280	a18c3be8-6893-4232-8ffa-e61f84049496	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
cc10042e-de6d-4826-a9b4-f318278e2d82	93559c7b-1836-48c5-bd6d-cd895e547b6e	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
308b9009-6ecf-4b4a-a629-0c9742f43f1a	d93d219a-610d-42f5-a5c9-d6d355b236f2	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 00:55:11.014189+00
8e65d5bd-7326-4022-8b66-25e80cd5dfc9	898162b4-0df4-41c0-b660-08ae42921b5f	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
5d2deb11-942f-4a60-8f27-d51ce550b596	30b0db18-fb03-416d-9789-aff8abaaff0b	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
0be36781-e59c-4dd1-ae9f-fda05905c92f	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
f0d48e25-44db-42c6-8616-58421a96a91f	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
285a2c09-d83e-4d01-9a93-581746c523f8	1a195567-49ff-43de-8d82-f39ee3c6f52a	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
60f53450-15bb-4392-b3ad-c24b93f5f40f	db78b658-294e-4cd9-9311-b92195697fb0	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
59217c75-e81d-4f45-8f17-24d4fa7ceb34	a18c3be8-6893-4232-8ffa-e61f84049496	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
fe626de8-c0c7-457b-8f4f-f203d0379d15	93559c7b-1836-48c5-bd6d-cd895e547b6e	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
8a83455b-b652-4b82-92ad-8d645b5945e3	d93d219a-610d-42f5-a5c9-d6d355b236f2	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 00:55:11.014189+00
a824dc6e-0c49-4831-aafe-3de8987b7e0f	898162b4-0df4-41c0-b660-08ae42921b5f	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
16d51cca-93f3-44e9-8cf9-7a30b9a88c8d	30b0db18-fb03-416d-9789-aff8abaaff0b	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
ce628bdc-0927-46af-bdbe-bbed0a717c97	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
1bba03c3-fde5-47c7-b82b-77509402950c	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
f6f34051-ab28-405c-bae8-3afa91d11110	1a195567-49ff-43de-8d82-f39ee3c6f52a	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
8e001c0d-8305-425e-9bd4-e8f86dd28806	db78b658-294e-4cd9-9311-b92195697fb0	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
36cb1872-1e42-4122-9bed-d2a1bdf0ae35	a18c3be8-6893-4232-8ffa-e61f84049496	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
3cbc04af-e0d5-4140-925d-71d975bcc0dd	93559c7b-1836-48c5-bd6d-cd895e547b6e	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
262ee1d7-b4e5-4a02-b579-bee1f296140a	d93d219a-610d-42f5-a5c9-d6d355b236f2	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 00:55:11.014189+00
1865d2d9-de40-4a96-882a-9806c2e39c56	898162b4-0df4-41c0-b660-08ae42921b5f	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
13d70030-0c27-4add-9b45-5e43986dc0b1	30b0db18-fb03-416d-9789-aff8abaaff0b	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
d6723fa0-74a1-417d-9f27-3bc97a76494b	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
ae032ee9-cfce-43c0-9f3a-2db40f392d1f	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
438d4892-b75d-4cd7-a4b1-d1b998791737	1a195567-49ff-43de-8d82-f39ee3c6f52a	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
f18bc829-ea50-4a4e-800a-8297b3d124a0	db78b658-294e-4cd9-9311-b92195697fb0	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
595645c8-569d-47e1-8b68-a8a5fd9ed3cd	a18c3be8-6893-4232-8ffa-e61f84049496	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
133c8fce-262c-4e27-ae5d-137d72020fbc	93559c7b-1836-48c5-bd6d-cd895e547b6e	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
63af3e45-07e8-40cf-a972-eeaa1da8c9fe	d93d219a-610d-42f5-a5c9-d6d355b236f2	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 00:55:11.014189+00
f5d4fa7d-5f65-4c01-bf3c-612553849dba	898162b4-0df4-41c0-b660-08ae42921b5f	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
b21e4f2b-5f64-4394-8165-2543443b1bc5	30b0db18-fb03-416d-9789-aff8abaaff0b	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
081817c4-c091-4ccc-967a-8430cba51e74	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
db47be30-d70d-4a6e-add0-a7c004b53348	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
c83f20ee-a7d1-47f4-9e38-47211d800d8a	1a195567-49ff-43de-8d82-f39ee3c6f52a	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
a26646c9-e1d3-4089-98d9-75216b449b9b	db78b658-294e-4cd9-9311-b92195697fb0	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
80fd7849-e4d3-4c4c-aa47-ca5f9510a4c4	a18c3be8-6893-4232-8ffa-e61f84049496	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
6c7c8d75-3d6a-4e16-a099-7bfa6e8b0c73	93559c7b-1836-48c5-bd6d-cd895e547b6e	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
7376cfef-35f4-4ba9-a69a-7d56b0e2e1c6	d93d219a-610d-42f5-a5c9-d6d355b236f2	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 00:55:11.014189+00
bb109c03-ca3d-42e0-a8d8-bda303732dbf	898162b4-0df4-41c0-b660-08ae42921b5f	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
f06ad446-cd3a-48fb-8224-3a45889c7688	30b0db18-fb03-416d-9789-aff8abaaff0b	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
45b6f11c-51c0-4b8f-9954-d9f6831e063a	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
fc6481da-d151-4d36-9266-a3580b0c91cf	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
4b722594-0f73-457d-aac5-6ac13553d976	1a195567-49ff-43de-8d82-f39ee3c6f52a	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
da7d78e4-c4fc-461d-8296-f6837f2774e5	db78b658-294e-4cd9-9311-b92195697fb0	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
ba6b16ef-f12e-49a5-8d69-07c8eac1369d	a18c3be8-6893-4232-8ffa-e61f84049496	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
9899a2e9-bdf2-4494-9fb0-e23ec1cfa915	93559c7b-1836-48c5-bd6d-cd895e547b6e	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
9c6ac0a6-5476-4a00-80ce-d460b79bf69c	d93d219a-610d-42f5-a5c9-d6d355b236f2	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 00:55:11.014189+00
3355c891-b516-4072-8dc4-fbf238899ef6	898162b4-0df4-41c0-b660-08ae42921b5f	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
7b45c0de-299a-47d0-bb49-a658a4a36d41	30b0db18-fb03-416d-9789-aff8abaaff0b	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
3256231b-dea3-44cf-85e9-56eca58862f5	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
23eeaca4-1ed0-44dc-94b6-dc32ff8fa973	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
8294dd7b-3e20-4477-ba63-b3989240155f	1a195567-49ff-43de-8d82-f39ee3c6f52a	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
ea06f4f4-f907-4e1a-9bbd-6eca313543c2	db78b658-294e-4cd9-9311-b92195697fb0	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
e7b1cc62-88ec-4d77-bcd1-a435659c3ae7	a18c3be8-6893-4232-8ffa-e61f84049496	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
609c0815-596b-422b-9ff7-45dc1e1202a3	93559c7b-1836-48c5-bd6d-cd895e547b6e	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
c34ebda6-9ab1-478d-80c8-7e0ae20739ac	d93d219a-610d-42f5-a5c9-d6d355b236f2	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 00:55:11.014189+00
0e3821fc-c0e8-4f29-b48f-6cbe76822891	898162b4-0df4-41c0-b660-08ae42921b5f	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
c6f5bb9a-85af-4841-b1ba-36b24085ec0a	30b0db18-fb03-416d-9789-aff8abaaff0b	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
1bb0af42-aa8c-41cd-bd4c-62a10ad94869	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
88b9a68e-0822-48ba-971c-f4f338b097ca	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
e70992c8-454c-4e34-b0ab-74d144ea81ee	1a195567-49ff-43de-8d82-f39ee3c6f52a	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
860ed60d-ffd4-4117-aafd-e528be5c3051	db78b658-294e-4cd9-9311-b92195697fb0	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
6e1c3e65-daec-4fe1-92db-3908a94b5a95	a18c3be8-6893-4232-8ffa-e61f84049496	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
292926c0-9d13-4e80-a35e-9040bf556ced	93559c7b-1836-48c5-bd6d-cd895e547b6e	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
e870cd70-dede-4ef4-afdc-280ca1251f64	d93d219a-610d-42f5-a5c9-d6d355b236f2	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 00:55:11.014189+00
1b6f9ec3-fe44-4d91-bd55-8263e16ea34d	898162b4-0df4-41c0-b660-08ae42921b5f	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
0df307dd-a2ea-4269-8058-748d886924c4	30b0db18-fb03-416d-9789-aff8abaaff0b	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
2f7c18de-a935-485a-8c32-b27fc61f60e6	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
8169a7cb-ccd7-409a-ba35-2fcd829c5041	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
ff799dcd-960f-4385-9ad2-cafcb7fa2312	1a195567-49ff-43de-8d82-f39ee3c6f52a	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
3103ef55-b5ad-457e-add7-45a9760f26fc	db78b658-294e-4cd9-9311-b92195697fb0	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
80ae1387-753a-4a0e-a73a-ca92edae1f9a	a18c3be8-6893-4232-8ffa-e61f84049496	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
c0351afb-ba14-48ec-81ba-cbb0a285ef97	93559c7b-1836-48c5-bd6d-cd895e547b6e	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
10667f6e-726d-4008-bbb7-458e93f4e788	d93d219a-610d-42f5-a5c9-d6d355b236f2	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 00:55:11.014189+00
43e13794-3582-455a-ae9c-ab1ca5027342	898162b4-0df4-41c0-b660-08ae42921b5f	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
59674ac1-a928-4874-b1cb-1af328393790	30b0db18-fb03-416d-9789-aff8abaaff0b	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
1064837f-8041-4db0-ba86-08e7ab617513	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
2d2d7709-e730-47e4-843e-3563dbebec4c	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
e0419b49-f844-4201-be7d-62ead749b3de	1a195567-49ff-43de-8d82-f39ee3c6f52a	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
50b201e4-6d90-4f98-8ad6-d6afc3fd9076	db78b658-294e-4cd9-9311-b92195697fb0	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
3f57b94b-6502-426f-8ce9-e35c5c8bb8f7	a18c3be8-6893-4232-8ffa-e61f84049496	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
4d0d8d9e-38c5-4e0c-8474-c5a0c8b57b12	93559c7b-1836-48c5-bd6d-cd895e547b6e	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
03a512a0-2224-4f68-8855-7bb40d4b86da	d93d219a-610d-42f5-a5c9-d6d355b236f2	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 00:55:11.014189+00
602d8a4b-dd2a-453c-9760-c4e46d938956	898162b4-0df4-41c0-b660-08ae42921b5f	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
b5bb23e7-00ab-4320-b52a-6ccffa3d289b	30b0db18-fb03-416d-9789-aff8abaaff0b	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
73964d56-bc33-4a03-a86f-e78adce35636	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
ec4486d1-8c60-4c3b-ade9-9eeaaf5fffb6	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
ed4ca50f-7b0c-4e32-aa1c-9945dc381e08	1a195567-49ff-43de-8d82-f39ee3c6f52a	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
f21674f4-e529-42f0-893a-83453563eb32	db78b658-294e-4cd9-9311-b92195697fb0	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
aedd0f55-dd8b-4554-b2c3-ee197d915e2a	a18c3be8-6893-4232-8ffa-e61f84049496	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
24c5d7dc-ffad-4f8a-8176-673ac50525e6	93559c7b-1836-48c5-bd6d-cd895e547b6e	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
1bddb5b3-2fef-46e5-ac80-31f54427919a	d93d219a-610d-42f5-a5c9-d6d355b236f2	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 00:55:11.014189+00
f660411d-fb19-4287-823c-e7f4c84de429	898162b4-0df4-41c0-b660-08ae42921b5f	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
d37ade70-b88c-4ae9-8161-a4fb4909ff36	30b0db18-fb03-416d-9789-aff8abaaff0b	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
bc98f894-267c-402d-b4e0-ff97d3096498	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
491f4fc6-8317-4573-99b3-89b016496b9f	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
aa27c565-a673-4392-93c1-21786c88bfc4	1a195567-49ff-43de-8d82-f39ee3c6f52a	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
37e7005c-1efc-43e4-be5d-2ce63601ff69	db78b658-294e-4cd9-9311-b92195697fb0	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
e12994af-ce3b-41ae-ba50-78afe162f781	a18c3be8-6893-4232-8ffa-e61f84049496	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
6bdb6950-77a7-43f5-abe3-6db7fd58a1eb	93559c7b-1836-48c5-bd6d-cd895e547b6e	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
10639d36-feca-4420-93a6-2ba881c2319b	d93d219a-610d-42f5-a5c9-d6d355b236f2	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 00:55:11.014189+00
962aeceb-0229-478e-a680-8c1015b2752d	898162b4-0df4-41c0-b660-08ae42921b5f	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
7b7b745a-e4ab-4cb3-9f25-c9a71ac8434b	30b0db18-fb03-416d-9789-aff8abaaff0b	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
e349dcaf-661a-43d8-a231-106543d78288	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
47002eda-677e-48cb-8b4c-742b8c473d16	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
fcf63149-351b-4ea4-ac33-2239da46ee7f	1a195567-49ff-43de-8d82-f39ee3c6f52a	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
ed8beaeb-dced-4e3d-aedf-ac684d751d9f	db78b658-294e-4cd9-9311-b92195697fb0	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
08d6488f-a24e-4bd5-a663-1b592ef1b448	a18c3be8-6893-4232-8ffa-e61f84049496	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
6a95f433-bb4f-4378-b695-434fd40f06e6	93559c7b-1836-48c5-bd6d-cd895e547b6e	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
f30f9e7d-fc19-4b96-82d4-6d2cb0881bf3	d93d219a-610d-42f5-a5c9-d6d355b236f2	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 00:55:11.014189+00
886a12e3-72ea-4087-903d-edbe7bc15c7c	898162b4-0df4-41c0-b660-08ae42921b5f	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
1045d984-2407-4c93-bcb2-3fac1f359fa3	30b0db18-fb03-416d-9789-aff8abaaff0b	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
a9ed5f81-aecb-4c20-9510-dd9aa8dbd030	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
244c93b5-69ce-4209-9f89-c8095a3c2324	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
6795b9cd-e96c-437b-8407-8278c92ee0e1	1a195567-49ff-43de-8d82-f39ee3c6f52a	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
3940b79b-839d-4541-841c-3da1e16120ed	db78b658-294e-4cd9-9311-b92195697fb0	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
0f893c0c-8791-4152-97b5-9dcf66f34277	a18c3be8-6893-4232-8ffa-e61f84049496	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
9cb30514-ef71-487f-9ab9-b52034abcb4a	93559c7b-1836-48c5-bd6d-cd895e547b6e	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
02227057-0aa5-4e9d-9bfb-33b11ab6d426	d93d219a-610d-42f5-a5c9-d6d355b236f2	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 00:55:11.014189+00
36d80f10-6803-4162-8ef7-8d13ae1c62f0	898162b4-0df4-41c0-b660-08ae42921b5f	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
4cd5a677-c656-4e14-bf4e-04b4b3666a78	30b0db18-fb03-416d-9789-aff8abaaff0b	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
d41fefec-1fbd-41c6-b5dd-7ce7c9b097cc	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
ccbb96a3-2e58-4691-81e6-d6d0c3cb391c	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
57b9ca31-5391-4573-be0d-ebceeec91301	1a195567-49ff-43de-8d82-f39ee3c6f52a	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
11a6c95c-6797-45df-9bc1-cc5d0609c941	db78b658-294e-4cd9-9311-b92195697fb0	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
884e3c3b-ad38-4dff-b935-fd2f1168c887	a18c3be8-6893-4232-8ffa-e61f84049496	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
a9f1e6d4-746e-4d48-80cf-ad8195023d6e	93559c7b-1836-48c5-bd6d-cd895e547b6e	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
60a46393-04fb-4bd1-a976-8ded7186fa1e	d93d219a-610d-42f5-a5c9-d6d355b236f2	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 00:55:11.014189+00
65c5761f-005c-4e02-94bc-74d8bab24337	898162b4-0df4-41c0-b660-08ae42921b5f	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
6c5cae61-59c6-4704-9397-7555d2b0afc5	30b0db18-fb03-416d-9789-aff8abaaff0b	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
b9d13dad-24af-4061-b02e-ff95f1793e08	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
8c61a938-e56f-4929-9252-7e782c3b9449	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
aa94b857-e5f8-4b06-af21-6fa66c807135	1a195567-49ff-43de-8d82-f39ee3c6f52a	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
adbc7a23-7a7b-4aab-94b9-e3be55ed5970	db78b658-294e-4cd9-9311-b92195697fb0	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
40414330-08b7-4a36-a7eb-01a5b7a308bd	a18c3be8-6893-4232-8ffa-e61f84049496	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
65adc40d-38bb-4c50-b75a-c35985af350c	93559c7b-1836-48c5-bd6d-cd895e547b6e	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
734fee84-c8b3-48b0-b8ed-bcbba2e8d0fb	d93d219a-610d-42f5-a5c9-d6d355b236f2	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 00:55:11.014189+00
5b44ce97-ca63-4038-b938-7c379a3aae99	898162b4-0df4-41c0-b660-08ae42921b5f	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
c140b9d8-72af-44fc-b8bf-b05727753d7f	30b0db18-fb03-416d-9789-aff8abaaff0b	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
99e575eb-f8ef-4ec6-96f1-10a8bbaeb8a1	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
55eaee6e-52b7-4c7a-8b4d-42a0b2f300a1	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
d228382c-c385-4ea4-9c73-61b568285609	1a195567-49ff-43de-8d82-f39ee3c6f52a	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
dc13f6af-f2c8-477b-b236-2f3de471f20b	db78b658-294e-4cd9-9311-b92195697fb0	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
5009b485-1e47-4bb5-b35f-7801e2fad7bc	a18c3be8-6893-4232-8ffa-e61f84049496	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
f0e98874-8355-42a6-b30c-8582a2a0b868	93559c7b-1836-48c5-bd6d-cd895e547b6e	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
c3c050de-3352-4133-a7ef-350db4b9e3db	d93d219a-610d-42f5-a5c9-d6d355b236f2	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 00:55:11.014189+00
94a1013a-301e-4279-bf2d-9a703b7b838f	898162b4-0df4-41c0-b660-08ae42921b5f	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
95295e0e-830e-4462-922a-fb6153969d7c	30b0db18-fb03-416d-9789-aff8abaaff0b	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
ecd7c298-6700-4dca-bcb1-47f51bf7c08c	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
2b24e6c7-a4a8-477c-9af4-016748400de5	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
4c5f15f2-4fbe-4fef-895b-29e613fbb19c	1a195567-49ff-43de-8d82-f39ee3c6f52a	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
70eed07a-0b34-48a1-bda1-cf69b73a5471	db78b658-294e-4cd9-9311-b92195697fb0	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
ab07cb26-7438-436b-ad00-631ab81e6a82	a18c3be8-6893-4232-8ffa-e61f84049496	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
6da710f2-6509-4f6e-b941-104a19302e88	93559c7b-1836-48c5-bd6d-cd895e547b6e	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
07c4bbe1-6065-4394-a26f-57994199c814	d93d219a-610d-42f5-a5c9-d6d355b236f2	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 00:55:11.014189+00
e2851cfd-514d-4a9a-8d6c-959da8c0d4fd	898162b4-0df4-41c0-b660-08ae42921b5f	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
66023433-eace-4a17-b480-1970c3fa0ef8	30b0db18-fb03-416d-9789-aff8abaaff0b	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
d65261e6-bb78-4421-9d90-b1ba94412970	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
b399615f-b0e3-4269-8ea5-28fbf5b56800	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
a4c55c29-7876-4676-8fa4-a055e24d8652	1a195567-49ff-43de-8d82-f39ee3c6f52a	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
6b603694-2b70-4d65-9d17-16d720c71b05	db78b658-294e-4cd9-9311-b92195697fb0	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
51b57b35-c882-47ae-8ffd-136c052ee1ab	a18c3be8-6893-4232-8ffa-e61f84049496	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
8ad3b255-bcfc-4cb5-bd6b-b8652e00b054	93559c7b-1836-48c5-bd6d-cd895e547b6e	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
f98f3a1c-64a6-476c-9218-f972680665da	d93d219a-610d-42f5-a5c9-d6d355b236f2	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 00:55:11.014189+00
11030d0f-7ba3-4312-a271-bb5962e695b4	898162b4-0df4-41c0-b660-08ae42921b5f	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
13f5ee60-43fa-4f61-a0bf-f7320215f51b	30b0db18-fb03-416d-9789-aff8abaaff0b	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
0ba6e704-8ec3-4a2e-a4d8-3ecf9a085174	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
f93c1c6c-3aae-4d1c-96ab-76423f6fc389	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
5d8f273e-1f1f-4161-8efb-92405ea0e91f	1a195567-49ff-43de-8d82-f39ee3c6f52a	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
fe1a7329-1dc7-477a-bad1-cf508d76a96c	db78b658-294e-4cd9-9311-b92195697fb0	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
73e25b70-852c-493b-9919-f9164416b99a	a18c3be8-6893-4232-8ffa-e61f84049496	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
bed7c61b-fea1-4278-909e-966994bdb86e	93559c7b-1836-48c5-bd6d-cd895e547b6e	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
136045f6-787c-4721-a45b-427d176f8f31	d93d219a-610d-42f5-a5c9-d6d355b236f2	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 00:55:11.014189+00
ff05f038-8996-4eea-839d-173e1066b2f2	898162b4-0df4-41c0-b660-08ae42921b5f	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
ca1d01ae-b327-4043-accc-278f2bfb6380	30b0db18-fb03-416d-9789-aff8abaaff0b	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
59b133f8-4dc2-46c4-893a-f92a2fb80ef5	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
09ae0499-32b3-445e-910a-7eec092fd7ae	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
a74ff6c5-38f5-466e-ac5e-046e89c66de3	1a195567-49ff-43de-8d82-f39ee3c6f52a	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
fdc1eb43-c5ef-4d8a-948b-ec55b5c87163	db78b658-294e-4cd9-9311-b92195697fb0	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
1aa96203-01f3-460d-9984-d88385440fad	a18c3be8-6893-4232-8ffa-e61f84049496	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
b581415e-bd3f-4130-bdaf-5693349f1b88	93559c7b-1836-48c5-bd6d-cd895e547b6e	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
326eb9fc-4ab1-43bd-a55f-1398bc82eeca	d93d219a-610d-42f5-a5c9-d6d355b236f2	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 00:55:11.014189+00
2d27ac46-160c-4998-b612-af42e8134a96	898162b4-0df4-41c0-b660-08ae42921b5f	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
58b38b55-93df-442b-9bf8-5cad3415674d	30b0db18-fb03-416d-9789-aff8abaaff0b	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
995f797c-b6fb-45a0-b493-026c0a468ae1	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
5c5cbfd3-2b95-4fab-be02-4d7be47c4553	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
656bd9cb-3a45-4a88-8b13-683fd38dc440	1a195567-49ff-43de-8d82-f39ee3c6f52a	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
51d89d45-2079-4dd9-aa89-bb2e1e8d2a59	db78b658-294e-4cd9-9311-b92195697fb0	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
7dfd6df6-dbb9-47fd-bde7-fc2b388a3a19	a18c3be8-6893-4232-8ffa-e61f84049496	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
3acf0fe0-068f-45e5-ab0a-babe35866a62	93559c7b-1836-48c5-bd6d-cd895e547b6e	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
49474f76-59f6-43e5-8d98-c11db030d571	d93d219a-610d-42f5-a5c9-d6d355b236f2	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 00:55:11.014189+00
8545abd7-8224-4954-a30c-38f5efa5247d	898162b4-0df4-41c0-b660-08ae42921b5f	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
f2a2f7c0-9fc3-43a5-83af-c6aab3edad16	30b0db18-fb03-416d-9789-aff8abaaff0b	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
a692dfc3-0973-4bb5-9398-86b6627a4202	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
3e58ec5d-a40f-451b-b176-c74db78b2037	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
a079d86b-216f-4d7a-b5f2-ac7020e1b3ff	1a195567-49ff-43de-8d82-f39ee3c6f52a	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
11b92def-9731-4237-bbc5-3f9e60e02ebd	db78b658-294e-4cd9-9311-b92195697fb0	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
8ffb6c35-6532-4eb5-9423-32ced1649e4f	a18c3be8-6893-4232-8ffa-e61f84049496	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
2c67de75-574a-4d41-a498-260a322d9b42	93559c7b-1836-48c5-bd6d-cd895e547b6e	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
b154a8e1-c202-4c50-b84d-9622f4e16cbf	d93d219a-610d-42f5-a5c9-d6d355b236f2	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 00:55:11.014189+00
ede9b6b5-9076-4e50-b3ba-9b83f7b650e9	898162b4-0df4-41c0-b660-08ae42921b5f	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
d087858b-6c4e-46d1-ab40-2599fe69cc94	30b0db18-fb03-416d-9789-aff8abaaff0b	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
9ca8b17b-7885-4393-8328-fefd8bb40484	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
35502f8d-4e29-4a22-8809-52853471430e	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
e93bfb85-60fc-43b9-9015-d01106f5b94a	1a195567-49ff-43de-8d82-f39ee3c6f52a	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
0f68b531-573d-46f1-9631-0bfca59c1211	db78b658-294e-4cd9-9311-b92195697fb0	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
4f98b541-a4b7-423b-ab73-5e7432b42a9c	a18c3be8-6893-4232-8ffa-e61f84049496	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
18441ef6-a4af-4855-8fa4-10e366c65882	93559c7b-1836-48c5-bd6d-cd895e547b6e	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
d56908a5-2bc5-4ed0-aca2-48e33e0616fd	d93d219a-610d-42f5-a5c9-d6d355b236f2	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 00:55:11.014189+00
385bc6b4-3818-4689-849f-b5778c330f0b	898162b4-0df4-41c0-b660-08ae42921b5f	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
6d6240c6-1f41-4458-8532-31d1c9a32a72	30b0db18-fb03-416d-9789-aff8abaaff0b	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
845e42cf-3c4b-4679-81ce-6b2fdce40de7	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
4611dd4e-aec6-49e7-ba62-f0775b2d5598	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
0e585ac1-12bf-4708-b067-bcd6b5668f39	1a195567-49ff-43de-8d82-f39ee3c6f52a	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
5b6637b9-509f-49a1-982e-4a3f3709e711	db78b658-294e-4cd9-9311-b92195697fb0	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
998a412a-8058-46db-b089-dcf4f2cbca4e	a18c3be8-6893-4232-8ffa-e61f84049496	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
e2a604ea-0db2-44cb-a253-9ffb37829023	93559c7b-1836-48c5-bd6d-cd895e547b6e	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
dc937ba7-3e33-4514-bbf9-9ebe1b0c3eb6	d93d219a-610d-42f5-a5c9-d6d355b236f2	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 00:55:11.014189+00
f82c7bee-dedd-4213-b03c-82c793e3dea8	898162b4-0df4-41c0-b660-08ae42921b5f	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
d673123a-a0ec-4047-a647-420cf3ba45a8	30b0db18-fb03-416d-9789-aff8abaaff0b	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
141347f4-e060-4328-87dd-897cfaa928dd	30b0db18-fb03-416d-9789-aff8abaaff0b	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
95286b6e-82bc-49bc-86a8-7d4172f34982	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
a22bcc71-0af0-47c1-b8cb-b6fed2e84aae	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
b9389350-0e91-46ad-8d79-8d25ac987626	1a195567-49ff-43de-8d82-f39ee3c6f52a	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
94361205-ba4c-4fd1-bf8f-cb6575519d55	db78b658-294e-4cd9-9311-b92195697fb0	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
e04bd2b5-42eb-4f7f-a7e2-e9e597b32809	a18c3be8-6893-4232-8ffa-e61f84049496	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
a482b58a-7914-4caa-9d71-d55b321067bf	93559c7b-1836-48c5-bd6d-cd895e547b6e	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
e64bc8c5-e44b-4758-9d8b-22501477504a	d93d219a-610d-42f5-a5c9-d6d355b236f2	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 00:55:11.014189+00
b0deb6b9-c75b-4935-8161-f88abab08545	898162b4-0df4-41c0-b660-08ae42921b5f	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
46327294-d5c6-4b9f-9f12-7f67487781bd	30b0db18-fb03-416d-9789-aff8abaaff0b	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
29a81c95-d7f5-407f-87ff-562b562921d9	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
bb1bf9f3-ac95-426c-b008-d321a869b583	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
2eb9e020-d434-4046-9e7b-1a64c9a8adb6	1a195567-49ff-43de-8d82-f39ee3c6f52a	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
46b3632f-c5bd-42a1-832b-f1801d917e88	db78b658-294e-4cd9-9311-b92195697fb0	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
ad8e21fc-902c-40dd-b635-79e0743766e9	a18c3be8-6893-4232-8ffa-e61f84049496	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
72597804-8484-432d-842e-1cda6e6c8141	93559c7b-1836-48c5-bd6d-cd895e547b6e	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
3152b563-bb5e-4011-ac4d-39f38e9af585	d93d219a-610d-42f5-a5c9-d6d355b236f2	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 00:55:11.014189+00
b5f47f3c-86a5-446b-b45b-81e712f7b492	898162b4-0df4-41c0-b660-08ae42921b5f	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
ad746c6d-fe75-485e-b154-1da98a86cc98	30b0db18-fb03-416d-9789-aff8abaaff0b	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
a1da4757-79c8-40fc-8805-5be690e40ac7	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
c7f80b9d-ddc6-4fe8-9ad2-2d0402e7c79e	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
7253caab-7c8e-473d-b003-c0b0affb332f	1a195567-49ff-43de-8d82-f39ee3c6f52a	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
6fb85290-4c17-43cf-a4c1-5c5ee0264530	db78b658-294e-4cd9-9311-b92195697fb0	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
36e2f1c1-7468-4c50-8ab2-1049bdaab47b	a18c3be8-6893-4232-8ffa-e61f84049496	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
dac6d2f8-4022-45e4-a2c7-02db185ae8ed	93559c7b-1836-48c5-bd6d-cd895e547b6e	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
4429669e-cf47-44e1-bf5f-e6519c343ec9	d93d219a-610d-42f5-a5c9-d6d355b236f2	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 00:55:11.014189+00
e730199b-3808-4c24-b5bf-6faf1593dcff	898162b4-0df4-41c0-b660-08ae42921b5f	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
ca099ba5-740f-48fa-8342-16838c161ef3	30b0db18-fb03-416d-9789-aff8abaaff0b	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
4eae1fd5-ad7e-4c09-8ec7-54870a3e614a	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
80bbb33c-8147-4212-94f2-e223f67b549c	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
2e9b6a61-205a-4cd9-ab3e-5349bba5e405	1a195567-49ff-43de-8d82-f39ee3c6f52a	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
cefa5eb3-4e97-4497-8267-aabf433580b9	db78b658-294e-4cd9-9311-b92195697fb0	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
04a8acb7-464e-4c0c-bc5c-741c3bf4eff7	a18c3be8-6893-4232-8ffa-e61f84049496	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
8ed96164-9ef5-4d19-bdde-fb9fae0d285b	93559c7b-1836-48c5-bd6d-cd895e547b6e	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
c2880885-8b34-4453-be5f-943f92bcda5f	d93d219a-610d-42f5-a5c9-d6d355b236f2	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 00:55:11.014189+00
626d8f52-7817-4ad4-8a27-d4a44cf042e3	898162b4-0df4-41c0-b660-08ae42921b5f	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
2e93f223-6be8-46cd-ac93-c335aa9770bd	d93d219a-610d-42f5-a5c9-d6d355b236f2	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
4f340a53-26b5-46e6-b243-af35dfb07050	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
c0a5aae4-c73d-4830-b414-48b119e98fda	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
da6f5692-c190-4bfe-a2bf-e216de79a089	1a195567-49ff-43de-8d82-f39ee3c6f52a	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
12c41ad4-4778-4e75-870b-d91703c6c644	db78b658-294e-4cd9-9311-b92195697fb0	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
4b44dd34-0a56-45d9-9c8e-336afc81a695	a18c3be8-6893-4232-8ffa-e61f84049496	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
6958de52-b13c-4c4c-a017-f7928e66ba6f	93559c7b-1836-48c5-bd6d-cd895e547b6e	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
02442fca-47c4-4b05-b777-dc0c2f7c3634	d93d219a-610d-42f5-a5c9-d6d355b236f2	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 00:55:11.014189+00
aec5cd30-0a29-4c00-ad46-7572589abb0e	898162b4-0df4-41c0-b660-08ae42921b5f	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
8b916c6b-2aec-42b9-86d2-d880e17be740	30b0db18-fb03-416d-9789-aff8abaaff0b	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
faf4422f-1737-4c7e-97b5-bb7dd7e65aff	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
71d55a7a-c816-445a-9d1a-c02e4a75d435	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
ae3a332e-c529-4ca8-90fb-c831283a8818	1a195567-49ff-43de-8d82-f39ee3c6f52a	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
505f8a6e-d948-45ef-b002-08b002533a3e	db78b658-294e-4cd9-9311-b92195697fb0	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
3e9df48e-b7d5-42fc-b351-d81c5a2eb564	a18c3be8-6893-4232-8ffa-e61f84049496	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
1f8ebcda-dd3b-476a-84d9-71b1401f7d0b	93559c7b-1836-48c5-bd6d-cd895e547b6e	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
b7ea75cc-405e-4c25-afed-4faa22aabac7	d93d219a-610d-42f5-a5c9-d6d355b236f2	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 00:55:11.014189+00
3138ef19-e005-4e04-80aa-5ea8bd0788d1	898162b4-0df4-41c0-b660-08ae42921b5f	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
40dbcd13-c003-4a32-aeeb-654356bebf47	30b0db18-fb03-416d-9789-aff8abaaff0b	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
b9e81c55-d859-4c2d-a3e0-5d672f850f11	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
9c1b9156-907f-4b42-8d44-14e02cc722f1	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
d30f5ad5-7ab3-4ecd-b580-079a5b6b57fd	1a195567-49ff-43de-8d82-f39ee3c6f52a	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
e42d973b-cff0-4341-acf9-dd48d10af170	db78b658-294e-4cd9-9311-b92195697fb0	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
75f2d76e-b362-4742-bbe6-77d7685b4ea5	a18c3be8-6893-4232-8ffa-e61f84049496	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
76d8c1c7-3855-4f9e-885e-96c937e19129	93559c7b-1836-48c5-bd6d-cd895e547b6e	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
1f0346af-d34b-4415-9562-eaaf971e7ff6	d93d219a-610d-42f5-a5c9-d6d355b236f2	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 00:55:11.014189+00
fc88d40a-d865-4c7e-93eb-a806249455f2	898162b4-0df4-41c0-b660-08ae42921b5f	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
f9a08e38-76dd-4658-a3e1-a5e042b1d95b	30b0db18-fb03-416d-9789-aff8abaaff0b	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
27325b2a-e575-434f-b1aa-44c557adcc3d	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
89787396-41ab-4213-a793-c1bc2fea70b6	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
cc5320a5-a74c-4fea-b875-893041ea4112	1a195567-49ff-43de-8d82-f39ee3c6f52a	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
f8f24446-78b5-4000-ba6d-309c3b338b19	db78b658-294e-4cd9-9311-b92195697fb0	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
a88b5d24-22a0-4358-b6d5-f3b30080348f	a18c3be8-6893-4232-8ffa-e61f84049496	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
888457b3-6be4-4ef4-8f31-ef32f8088409	93559c7b-1836-48c5-bd6d-cd895e547b6e	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
18242e07-1f3b-419e-8d1b-6991bed37a03	d93d219a-610d-42f5-a5c9-d6d355b236f2	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 00:55:11.014189+00
959433f8-7f03-401f-9183-0880e4ab94fb	898162b4-0df4-41c0-b660-08ae42921b5f	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
78f48630-20d5-4109-babc-f63e1118be02	30b0db18-fb03-416d-9789-aff8abaaff0b	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
5c9f2cec-c0ab-41c6-9bcc-f2b693086bd6	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
56b2fa90-4165-4ebd-98e9-fe985dd795dd	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
a6a85113-5611-42c6-aa0d-7dd452a38a07	1a195567-49ff-43de-8d82-f39ee3c6f52a	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
b21372ca-e96c-4e02-b391-fa4dbb1e1405	db78b658-294e-4cd9-9311-b92195697fb0	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
59dcca0c-6129-4841-ba10-8b05ef2da61a	a18c3be8-6893-4232-8ffa-e61f84049496	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
502937f9-21de-45ba-9207-6611285c9ad0	93559c7b-1836-48c5-bd6d-cd895e547b6e	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
b7041f03-1ad4-4245-8c54-b53c41f72341	d93d219a-610d-42f5-a5c9-d6d355b236f2	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 00:55:11.014189+00
332c888e-abf6-4869-8001-72a353669101	898162b4-0df4-41c0-b660-08ae42921b5f	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
c2f0b78b-2732-43d9-9632-1e44f325fe90	30b0db18-fb03-416d-9789-aff8abaaff0b	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
669d8dcc-0536-44fe-abcd-34b8625e5b65	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
1f2b8746-2d30-49fd-af4d-8fefd95f8ea0	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
a6ec5ff2-e2ba-4a42-903a-d949dae147c6	1a195567-49ff-43de-8d82-f39ee3c6f52a	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
74f2a2a4-756f-4231-866d-3f3903aa997a	db78b658-294e-4cd9-9311-b92195697fb0	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
9d225a7b-dd19-4c9b-a763-87e4210d2e10	a18c3be8-6893-4232-8ffa-e61f84049496	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
0ea0d978-7ee2-47f8-97ec-783f736c677e	93559c7b-1836-48c5-bd6d-cd895e547b6e	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
ba7bd704-58e6-4b8f-abd7-be2e36d8fa2d	d93d219a-610d-42f5-a5c9-d6d355b236f2	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 00:55:11.014189+00
3a106107-c883-49de-a7a6-179651c16d7f	898162b4-0df4-41c0-b660-08ae42921b5f	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
577ccdd7-4897-41c9-9086-166e6ade6a90	30b0db18-fb03-416d-9789-aff8abaaff0b	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
798c2122-bd26-4917-8d63-89fec572dc97	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
12634143-fce9-46c8-bd11-53ad56b45a08	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
41257223-1c5b-4900-a3b1-da642eabb0a0	1a195567-49ff-43de-8d82-f39ee3c6f52a	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
52cdc75b-629f-4be1-a5bf-6f52aaf3f74e	db78b658-294e-4cd9-9311-b92195697fb0	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
0adde108-bb6c-4b00-928b-557f1afd3240	a18c3be8-6893-4232-8ffa-e61f84049496	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
d6367fd2-2b71-4a63-98ae-2318d45c7a3f	93559c7b-1836-48c5-bd6d-cd895e547b6e	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
772ac8d5-317f-4dc3-b53c-05c68ae7b1f6	d93d219a-610d-42f5-a5c9-d6d355b236f2	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 00:55:11.014189+00
940f4303-c5ff-4bce-b2f1-ac9565bdbf97	898162b4-0df4-41c0-b660-08ae42921b5f	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
10a3c963-fe62-4ad2-88a3-b5d9d4e23369	30b0db18-fb03-416d-9789-aff8abaaff0b	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
a933a637-492f-4967-a754-eda328726502	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
ba8bc620-bb3a-4bf2-a33a-2ed506cd9783	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
e6ce1595-b9aa-4b14-bdc7-640471265dd3	1a195567-49ff-43de-8d82-f39ee3c6f52a	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
7fab41c8-d47a-412d-bc7f-3bccbbe58662	db78b658-294e-4cd9-9311-b92195697fb0	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
7539b443-7a1a-4525-ae2f-4e0428e3a61a	a18c3be8-6893-4232-8ffa-e61f84049496	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
e7b58ae0-1836-45f8-976f-c9c160dee457	93559c7b-1836-48c5-bd6d-cd895e547b6e	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
0b56a3a6-1c9c-4691-acc9-76b2407a4f2f	d93d219a-610d-42f5-a5c9-d6d355b236f2	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 00:55:11.014189+00
80aeec22-742c-4336-bee0-54d65e9ea924	898162b4-0df4-41c0-b660-08ae42921b5f	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
24215db9-6c5d-4776-a8b3-b362d35dc0a0	30b0db18-fb03-416d-9789-aff8abaaff0b	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
bd7e1506-e5d4-4b6c-a40f-91958c551386	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
cd766ba2-02e0-4aaa-8331-00166d93e36b	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
1baa25c9-8e7c-4099-93f9-3de78d177b61	1a195567-49ff-43de-8d82-f39ee3c6f52a	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
463d30a4-1a08-462c-a8fb-4a4e0af4abf9	db78b658-294e-4cd9-9311-b92195697fb0	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
9267ab8f-55ec-424c-96c0-a34b54e8c21a	a18c3be8-6893-4232-8ffa-e61f84049496	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
294316e6-6d81-4372-ae13-f9a0c3c798e0	93559c7b-1836-48c5-bd6d-cd895e547b6e	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
1cc287e0-043b-496b-9fdc-6e13454fe2d2	d93d219a-610d-42f5-a5c9-d6d355b236f2	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 00:55:11.014189+00
1d4e4433-fbb7-4967-9a13-207707678970	898162b4-0df4-41c0-b660-08ae42921b5f	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
6a36e18f-844e-46cb-ad1d-92eaf967cf05	30b0db18-fb03-416d-9789-aff8abaaff0b	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
f4bdb04f-893f-4df2-8134-ad349e393e09	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
0bbf967a-6f74-457a-be5c-033de59a339b	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
faed4d0f-1a9c-45d9-9eba-41cd17da1df2	1a195567-49ff-43de-8d82-f39ee3c6f52a	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
842313cb-506e-4db9-a8c1-50135919a391	db78b658-294e-4cd9-9311-b92195697fb0	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
5e9f2f19-2b69-4933-86c7-b26edc377801	a18c3be8-6893-4232-8ffa-e61f84049496	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
b9c585ef-166a-4083-8461-7f3525c1f031	93559c7b-1836-48c5-bd6d-cd895e547b6e	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 00:55:11.014189+00
55d69d14-2408-4888-937c-573c58b18bda	898162b4-0df4-41c0-b660-08ae42921b5f	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
b2af84da-e47f-48f0-aaa0-78171442e95c	30b0db18-fb03-416d-9789-aff8abaaff0b	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
55fc6e19-321a-4537-8494-029b56f3f317	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
d7a57f0e-4620-4f17-a54d-85ae2e5c77b9	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
85aa9482-d414-4ac7-9d33-636474a1f8df	1a195567-49ff-43de-8d82-f39ee3c6f52a	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
e556d635-dc0c-49d1-8b41-4db41bc5fe28	db78b658-294e-4cd9-9311-b92195697fb0	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
6b36bf99-9634-4730-961a-3d621478e8f3	a18c3be8-6893-4232-8ffa-e61f84049496	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
3735b781-1750-4057-91ec-ddb82c7b4cd3	93559c7b-1836-48c5-bd6d-cd895e547b6e	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
7c129687-0772-4d4d-bf34-b9399b46a961	d93d219a-610d-42f5-a5c9-d6d355b236f2	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 00:55:11.014189+00
acd29c30-adc9-4db7-a1fd-9a350d5e5f90	898162b4-0df4-41c0-b660-08ae42921b5f	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
44aec26a-655c-44f9-b7dc-2f513876572f	30b0db18-fb03-416d-9789-aff8abaaff0b	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
6fe53415-8c17-4033-bc70-d18347c6d493	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
8fa30039-2f3a-4d97-b60d-13ed96732468	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
98a7c415-daff-40a7-b986-788fa7aab08c	1a195567-49ff-43de-8d82-f39ee3c6f52a	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
ae3a865a-33ec-40cc-b523-6d8e5da600ec	db78b658-294e-4cd9-9311-b92195697fb0	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
64f1b474-4f1a-4e8d-b6e4-3124a991813c	a18c3be8-6893-4232-8ffa-e61f84049496	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
09d5795e-c81c-4203-8976-8188968d9ac7	93559c7b-1836-48c5-bd6d-cd895e547b6e	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
0209967b-6f05-4502-b68f-63a93f29084c	d93d219a-610d-42f5-a5c9-d6d355b236f2	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 00:55:11.014189+00
ae4a3fee-ba4d-4be3-a700-f7f701fdc698	898162b4-0df4-41c0-b660-08ae42921b5f	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
4e839a49-77d9-49ba-8cd5-d9ea1c55dfdb	30b0db18-fb03-416d-9789-aff8abaaff0b	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
28bd08b9-1003-42f6-b0cb-b3af6ce1ab27	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
18d03a05-ee16-4bec-ad5f-a2c766936c8b	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
c5313d8a-55a9-40f2-9903-160851f1b4f0	1a195567-49ff-43de-8d82-f39ee3c6f52a	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
685a34ba-ef0a-4a40-b645-2949519df243	db78b658-294e-4cd9-9311-b92195697fb0	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
e0924e97-7671-465c-862a-ea5f6b50a370	a18c3be8-6893-4232-8ffa-e61f84049496	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
7c0da877-fd0a-40a5-9647-162a469523bf	93559c7b-1836-48c5-bd6d-cd895e547b6e	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
77f0606c-2bba-4f0b-9821-b081914ac74c	d93d219a-610d-42f5-a5c9-d6d355b236f2	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 00:55:11.014189+00
c4750977-7cbd-4650-95d0-f0ee07e61b74	898162b4-0df4-41c0-b660-08ae42921b5f	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
7679eda2-aecf-4c96-8fc9-2e893b0dfe06	30b0db18-fb03-416d-9789-aff8abaaff0b	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
ce67f275-6c2e-4fc3-a990-44129691b7d4	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
687fcec1-77bb-4df4-9913-a7d271f43f47	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
494773a3-9547-4416-b1de-6c8bfdd804ec	1a195567-49ff-43de-8d82-f39ee3c6f52a	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
b6a2ebaa-dcdd-4b9a-b6f1-1e4f29bc7a20	db78b658-294e-4cd9-9311-b92195697fb0	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
ed96545a-cfdc-4b3a-8330-27ef32318ea0	a18c3be8-6893-4232-8ffa-e61f84049496	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
34ff42a6-814a-47fb-88fa-3eb4f34d831c	93559c7b-1836-48c5-bd6d-cd895e547b6e	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
087ba294-0008-42ab-9d5a-b20757d19916	d93d219a-610d-42f5-a5c9-d6d355b236f2	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 00:55:11.014189+00
357ed7d5-a915-41b4-9163-459d0f1c801d	898162b4-0df4-41c0-b660-08ae42921b5f	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
4cab93f9-0790-4e70-907a-8c1994d4f39c	30b0db18-fb03-416d-9789-aff8abaaff0b	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
c88600e4-abc5-44bc-ab5e-23f1b8effcae	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
d83abb16-93ae-4d18-b88f-c9ce3f0a59cb	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
d060347a-281b-4d70-9bd8-9a58e7cd11c2	1a195567-49ff-43de-8d82-f39ee3c6f52a	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
1ca6f53c-1c70-49fb-b724-c0d504fe5131	db78b658-294e-4cd9-9311-b92195697fb0	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
bf03ed04-d79e-4487-8f1c-ef351abfe22f	a18c3be8-6893-4232-8ffa-e61f84049496	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
aef4c5e1-46dc-4e72-b47b-92801af85a82	93559c7b-1836-48c5-bd6d-cd895e547b6e	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
650370b5-e56b-436c-b60d-e4f060984bd4	d93d219a-610d-42f5-a5c9-d6d355b236f2	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 00:55:11.014189+00
272048ad-e8fe-4d36-80ca-8cfd010a45c8	898162b4-0df4-41c0-b660-08ae42921b5f	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
36020fb2-0e52-4404-a9c7-9d52638f37c2	30b0db18-fb03-416d-9789-aff8abaaff0b	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
30307cfc-6723-4a6d-a392-4e4afbbfc9ad	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
4f2b2db3-edc8-43b3-9ce4-aacfeef106e2	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
9a457b81-0b66-4c76-b392-e74f75491aeb	1a195567-49ff-43de-8d82-f39ee3c6f52a	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
ffcb71f8-5a55-4c93-96c8-64cb45767f0c	db78b658-294e-4cd9-9311-b92195697fb0	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
088a8709-122b-4dd2-aa93-eabb4388e37d	a18c3be8-6893-4232-8ffa-e61f84049496	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
38f34e11-eb7b-4aca-85d2-29366fcb0c08	93559c7b-1836-48c5-bd6d-cd895e547b6e	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
d42bdefd-6e33-4d26-bbef-a650295e81f8	d93d219a-610d-42f5-a5c9-d6d355b236f2	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 00:55:11.014189+00
9908f48d-881b-457f-9536-555695157766	898162b4-0df4-41c0-b660-08ae42921b5f	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
ef4f0976-083c-463f-bc3a-1b60e3e1fc6c	30b0db18-fb03-416d-9789-aff8abaaff0b	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
e8f71b97-42e4-44aa-818a-11352b78465b	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
cdc6b82a-9dcb-4470-90fa-0b54de648f47	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
f61fddb0-a17a-47f0-9454-75c8a3f5245c	1a195567-49ff-43de-8d82-f39ee3c6f52a	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
ff3c0488-7b75-42df-8f57-24ffd41221e2	db78b658-294e-4cd9-9311-b92195697fb0	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
504b2af8-9aaa-4c6f-b5c5-62271c69f52b	a18c3be8-6893-4232-8ffa-e61f84049496	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
5b7d2659-47c5-40b6-b298-7e79c9c68c14	93559c7b-1836-48c5-bd6d-cd895e547b6e	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
95717a74-1d38-4191-9d67-16ab6f10b088	d93d219a-610d-42f5-a5c9-d6d355b236f2	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 00:55:11.014189+00
8ef7791b-1cab-45f8-ad01-cf17e376b2a5	378e240e-0713-4a21-b150-55a601ea1901	1	Q01	1	Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?	severity	direct	t	t	D	2026-03-03 13:40:29.721869+00
9127a8a1-63d7-4bc0-8001-35f78b20515a	378e240e-0713-4a21-b150-55a601ea1901	1	Q02	2	Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?	severity	inverted	t	t	E	2026-03-03 13:40:29.721869+00
c767a1e6-c66a-4054-bee6-609686622373	378e240e-0713-4a21-b150-55a601ea1901	1	Q03	3	Existe um canal seguro e sigiloso para denunciar assédio na empresa?	severity	inverted	t	t	F	2026-03-03 13:40:29.721869+00
d877dbeb-2a8d-48cc-b8ca-3369aaffb461	378e240e-0713-4a21-b150-55a601ea1901	1	Q04	4	Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?	severity	direct	t	t	G	2026-03-03 13:40:29.721869+00
42cda1a4-8cbd-40e5-af38-b8e2b1bebc36	378e240e-0713-4a21-b150-55a601ea1901	1	Q05	5	O RH e os gestores demonstram comprometimento real com a prevenção do assédio?	severity	inverted	t	t	H	2026-03-03 13:40:29.721869+00
c5b0e348-f156-4d48-b89f-8d2437c5a032	378e240e-0713-4a21-b150-55a601ea1901	2	Q06	6	Você sente que pode contar com seus colegas em momentos de dificuldade?	severity	inverted	t	t	I	2026-03-03 13:40:29.721869+00
f2db6c97-fb76-49f3-8432-f313474dc979	378e240e-0713-4a21-b150-55a601ea1901	2	Q07	7	Existe apoio da liderança para lidar com desafios relacionados ao trabalho?	severity	inverted	t	t	J	2026-03-03 13:40:29.721869+00
be49a0ed-39b8-411e-a195-4bdbb3c80d37	378e240e-0713-4a21-b150-55a601ea1901	2	Q08	8	O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?	severity	inverted	t	t	K	2026-03-03 13:40:29.721869+00
0db28295-fa32-4f4e-a730-fc85aa0dd234	378e240e-0713-4a21-b150-55a601ea1901	2	Q09	9	Os gestores promovem um ambiente saudável e respeitoso?	severity	inverted	t	t	L	2026-03-03 13:40:29.721869+00
db9afc92-ad24-4285-9989-3534a8fc27e7	378e240e-0713-4a21-b150-55a601ea1901	2	Q10	10	Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?	severity	inverted	t	t	M	2026-03-03 13:40:29.721869+00
82aa1c09-532b-4a54-ad1f-13f61dd75786	378e240e-0713-4a21-b150-55a601ea1901	3	Q11	11	Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?	severity	direct	t	t	N	2026-03-03 13:40:29.721869+00
e00f1140-9998-43f6-8b04-14d7610efae5	378e240e-0713-4a21-b150-55a601ea1901	3	Q12	12	Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?	severity	inverted	t	t	O	2026-03-03 13:40:29.721869+00
77e7f919-9c47-4983-954c-e9e60574ebd6	378e240e-0713-4a21-b150-55a601ea1901	3	Q13	13	Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?	severity	direct	t	t	P	2026-03-03 13:40:29.721869+00
fcaf3bf1-335f-4b82-a71f-853d3b49f280	378e240e-0713-4a21-b150-55a601ea1901	3	Q14	14	Existe transparência na comunicação da empresa durante processos de mudança?	severity	inverted	t	t	Q	2026-03-03 13:40:29.721869+00
dd6a342f-61cd-4657-ae18-435a89f3d266	378e240e-0713-4a21-b150-55a601ea1901	4	Q15	15	Você recebe instruções claras sobre suas responsabilidades no trabalho?	severity	inverted	t	t	R	2026-03-03 13:40:29.721869+00
4e76e13c-2203-4d82-ba7f-f22617da095f	378e240e-0713-4a21-b150-55a601ea1901	4	Q16	16	A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?	severity	inverted	t	t	S	2026-03-03 13:40:29.721869+00
c2b6a7a9-f04a-4a2c-8409-daad3dbaa0b4	378e240e-0713-4a21-b150-55a601ea1901	4	Q17	17	A comunicação entre equipes e setores contribui para a clareza das suas tarefas?	severity	inverted	t	t	T	2026-03-03 13:40:29.721869+00
4a7fd358-a85d-455d-89eb-efff24190333	378e240e-0713-4a21-b150-55a601ea1901	4	Q18	18	Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?	severity	inverted	t	t	U	2026-03-03 13:40:29.721869+00
91887b8a-2ce1-40ee-96ed-b2724dd1967f	378e240e-0713-4a21-b150-55a601ea1901	5	Q19	19	Você sente que seu esforço e desempenho são reconhecidos pela liderança?	severity	inverted	t	t	V	2026-03-03 13:40:29.721869+00
bc39060b-8ab6-426b-8cee-595929579879	378e240e-0713-4a21-b150-55a601ea1901	5	Q20	20	Você recebe feedback construtivo sobre o seu trabalho com regularidade?	severity	inverted	t	t	W	2026-03-03 13:40:29.721869+00
50062ac8-b2cd-4075-8de4-dc5491da06a8	378e240e-0713-4a21-b150-55a601ea1901	5	Q21	21	Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?	severity	direct	t	t	X	2026-03-03 13:40:29.721869+00
a584b48c-c21d-4563-abfd-f637322c66ff	378e240e-0713-4a21-b150-55a601ea1901	6	Q22	22	Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?	severity	inverted	t	t	Y	2026-03-03 13:40:29.721869+00
73149191-4d69-4fe5-aa6d-1afec7fb6cc4	378e240e-0713-4a21-b150-55a601ea1901	6	Q23	23	A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?	severity	inverted	t	t	Z	2026-03-03 13:40:29.721869+00
e1bc244c-80d1-475b-aee4-d54e98864b5c	378e240e-0713-4a21-b150-55a601ea1901	6	Q24	24	O excesso de controle ou burocracia interfere no seu desempenho?	severity	direct	t	t	AA	2026-03-03 13:40:29.721869+00
56cda63e-3008-4e78-8d65-23261ed34940	378e240e-0713-4a21-b150-55a601ea1901	6	Q25	25	Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?	severity	direct	t	t	AB	2026-03-03 13:40:29.721869+00
6805860e-9f63-4034-a589-a4f7381fdd26	378e240e-0713-4a21-b150-55a601ea1901	7	Q26	26	Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?	severity	inverted	t	t	AC	2026-03-03 13:40:29.721869+00
92110879-acdc-457b-8020-0199743ea5c8	378e240e-0713-4a21-b150-55a601ea1901	7	Q27	27	Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?	severity	inverted	t	t	AD	2026-03-03 13:40:29.721869+00
f3fd6758-c4e5-433f-854f-8b596aff105f	378e240e-0713-4a21-b150-55a601ea1901	7	Q28	28	Você sente que há transparência nas decisões de desligamento na empresa?	severity	inverted	t	t	AE	2026-03-03 13:40:29.721869+00
d5af7a3f-295d-418e-8e25-ee18ce401f9e	378e240e-0713-4a21-b150-55a601ea1901	7	Q29	29	Você já presenciou casos de demissões injustas?	severity	direct	t	t	AF	2026-03-03 13:40:29.721869+00
12e95928-6268-41e2-a977-3c90ad3ca57a	378e240e-0713-4a21-b150-55a601ea1901	8	Q30	30	Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?	severity	direct	t	t	AG	2026-03-03 13:40:29.721869+00
ad302860-0bfe-4a9d-a5b1-4e04c6151f65	378e240e-0713-4a21-b150-55a601ea1901	8	Q31	31	Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?	severity	direct	t	t	AH	2026-03-03 13:40:29.721869+00
d1b9e3e6-612a-4a9d-857b-35b4c845d5c8	378e240e-0713-4a21-b150-55a601ea1901	8	Q32	32	Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?	severity	direct	t	t	AI	2026-03-03 13:40:29.721869+00
19b4109c-2307-43f8-b733-1e013249410e	378e240e-0713-4a21-b150-55a601ea1901	9	Q33	33	Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?	severity	direct	t	t	AJ	2026-03-03 13:40:29.721869+00
807506c9-1ec5-4cd6-b7ab-83f7c0bf8bb9	378e240e-0713-4a21-b150-55a601ea1901	9	Q34	34	Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?	severity	direct	t	t	AK	2026-03-03 13:40:29.721869+00
e28122b6-f78a-489f-b077-1b54f2aebfc3	378e240e-0713-4a21-b150-55a601ea1901	9	Q35	35	Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?	severity	direct	t	t	AL	2026-03-03 13:40:29.721869+00
6a26f39c-0b5d-4225-a4c6-498cd43334dd	378e240e-0713-4a21-b150-55a601ea1901	9	Q36	36	Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?	severity	direct	t	t	AM	2026-03-03 13:40:29.721869+00
b18459db-5283-46bd-828e-020513b55b77	378e240e-0713-4a21-b150-55a601ea1901	10	Q37	37	Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?	severity	direct	t	t	AN	2026-03-03 13:40:29.721869+00
959561d6-aeb3-4199-9b4a-aa08ccea2a78	378e240e-0713-4a21-b150-55a601ea1901	10	Q38	38	Você frequentemente precisa fazer horas extras ou levar trabalho para casa?	severity	direct	t	t	AO	2026-03-03 13:40:29.721869+00
903a529e-13b8-481c-94fb-a9335e869746	378e240e-0713-4a21-b150-55a601ea1901	10	Q39	39	Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?	severity	direct	t	t	AP	2026-03-03 13:40:29.721869+00
23c4e260-5b86-4b20-8605-d7cfda5b5b44	378e240e-0713-4a21-b150-55a601ea1901	10	Q40	40	A equipe é dimensionada corretamente para a demanda de trabalho existente?	severity	inverted	t	t	AQ	2026-03-03 13:40:29.721869+00
2f7a142b-ec79-4777-a45c-4550797c7352	378e240e-0713-4a21-b150-55a601ea1901	11	Q41	41	Você já evitou colegas ou superiores por causa de desentendimentos frequentes?	severity	direct	t	t	AR	2026-03-03 13:40:29.721869+00
c07c3a49-71d8-40bd-8ca0-923cc74a03d6	378e240e-0713-4a21-b150-55a601ea1901	11	Q42	42	Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?	severity	direct	t	t	AS	2026-03-03 13:40:29.721869+00
2d580a5c-96c5-4166-9603-a1dc44bf11c9	378e240e-0713-4a21-b150-55a601ea1901	11	Q43	43	Conflitos no trabalho costumam ser resolvidos de forma justa?	severity	inverted	t	t	AT	2026-03-03 13:40:29.721869+00
dd0eab35-ce1b-427a-a37a-c513cdfe65a7	378e240e-0713-4a21-b150-55a601ea1901	12	Q44	44	Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?	severity	direct	t	t	AU	2026-03-03 13:40:29.721869+00
aaf34708-539c-4039-8267-1e6b39150a91	378e240e-0713-4a21-b150-55a601ea1901	12	Q45	45	A distância física entre você e sua equipe ou liderança dificulta a troca de informações?	severity	direct	t	t	AV	2026-03-03 13:40:29.721869+00
c5262002-a8f7-4430-a01f-ffbce77fbdb6	378e240e-0713-4a21-b150-55a601ea1901	12	Q46	46	Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?	severity	direct	t	t	AW	2026-03-03 13:40:29.721869+00
0705d7b5-e784-436b-817d-fdbc89205548	378e240e-0713-4a21-b150-55a601ea1901	12	Q47	47	Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?	severity	inverted	t	t	AX	2026-03-03 13:40:29.721869+00
afdac71a-f59b-473b-b491-aa61a69a6086	378e240e-0713-4a21-b150-55a601ea1901	13	Q48	48	Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?	severity	direct	t	t	AY	2026-03-03 13:40:29.721869+00
112e0735-560c-4dea-8c02-0acbe032b0a4	378e240e-0713-4a21-b150-55a601ea1901	13	Q49	49	Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?	severity	direct	t	t	AZ	2026-03-03 13:40:29.721869+00
d2112b12-7aa4-4685-81be-a1a8f606f6ad	378e240e-0713-4a21-b150-55a601ea1901	13	Q50	50	Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?	severity	inverted	t	t	BA	2026-03-03 13:40:29.721869+00
\.


--
-- Data for Name: survey_sectors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."survey_sectors" ("id", "survey_id", "key", "name", "risk_parameter", "access_token", "is_active", "submission_count", "last_submitted_at", "created_at", "updated_at") FROM stdin;
59ab3753-fe84-4c39-900f-b83cd2be12c9	cccccccc-cccc-cccc-cccc-cccccccc2001	sdfasdfasd	sdfasdfasd	1.0000	4fe642d7cc204e70b3ea4789edee945ae26d	t	0	\N	2026-03-03 00:42:32.254371+00	2026-03-03 00:42:32.254371+00
34c88906-88da-40b9-90aa-dcf3cd1d6684	cccccccc-cccc-cccc-cccc-cccccccc2010	sdfasdfasd	sdfasdfasd	1.0000	aa8b89fed84247a48b6638d16ceb76a29513	t	0	\N	2026-03-03 00:42:32.846457+00	2026-03-03 00:42:32.846457+00
30d853c8-c579-4ba0-9860-ccf7d4fbcf21	38795b48-5b66-4576-bfa8-1ea0223e57b1	sdfasdfasd	sdfasdfasd	1.0000	475ff9ae8ef94cabb245d4e8cc3e599a2d68	t	0	\N	2026-03-03 00:42:33.020127+00	2026-03-03 00:42:33.020127+00
8fccd8ed-4b82-47ea-913b-0897c158062b	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	sdfasdfasd	sdfasdfasd	1.0000	1e2132aa4a56434184f6297da6fe66feb1b2	t	0	\N	2026-03-03 00:42:33.221319+00	2026-03-03 00:42:33.221319+00
77000000-0000-0000-0000-000000000001	11111111-1111-1111-1111-111111111020	tecnologia	Tecnologia	1.2500	tc-q2-sim20-tech-token-01	t	8	2026-03-03 03:00:00+00	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00
77000000-0000-0000-0000-000000000002	11111111-1111-1111-1111-111111111020	financeiro	Financeiro	1.1000	tc-q2-sim20-fin-token-02	t	6	2026-03-04 15:00:00+00	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00
77000000-0000-0000-0000-000000000003	11111111-1111-1111-1111-111111111020	comercial	Comercial	0.9500	tc-q2-sim20-com-token-03	t	6	2026-03-06 03:00:00+00	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00
be88050e-ca2f-4585-8a46-5a51f5b2435c	378e240e-0713-4a21-b150-55a601ea1901	dfgsdfgd	dfgsdfgd	1.0000	Lx2B1KbSmZnUqyJSCENc9HdJ	t	0	\N	2026-03-03 13:40:30.897296+00	2026-03-03 13:40:55.795+00
6e871aa0-8716-4ffc-9f1e-bd06287acf1b	11111111-1111-1111-1111-111111111003	operacoes	Operacoes	1.3000	JtKhPPytH1VvX7hRsbeICIEG	t	0	\N	2026-03-03 15:36:43.777337+00	2026-03-03 15:36:43.777337+00
06d3e99b-9255-4728-907d-64c779e8b89b	11111111-1111-1111-1111-111111111003	manutencao	Manutencao	1.2000	VzhG_w9yXIFKhMif1nVSs0SM	t	0	\N	2026-03-03 15:36:44.501916+00	2026-03-03 15:36:44.501916+00
c9787652-88ae-46ba-b00d-e1486f84f2bd	11111111-1111-1111-1111-111111111003	seguranca	Seguranca	1.1500	gJ9dePNYPzvrt4r_mHvlM60Y	t	0	\N	2026-03-03 15:36:45.238293+00	2026-03-03 15:36:45.238293+00
\.


--
-- Data for Name: responses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."responses" ("id", "survey_id", "submitted_at", "session_sid", "ip_hash", "group_values", "answers_json", "sector_id") FROM stdin;
22222222-2222-2222-2222-222222220001	11111111-1111-1111-1111-111111111002	2026-02-02 10:00:00+00	\N	\N	{"sector": "Tecnologia"}	[]	\N
22222222-2222-2222-2222-222222220002	11111111-1111-1111-1111-111111111002	2026-02-06 10:00:00+00	\N	\N	{"sector": "Tecnologia"}	[]	\N
22222222-2222-2222-2222-222222220003	11111111-1111-1111-1111-111111111002	2026-02-11 10:00:00+00	\N	\N	{"sector": "Tecnologia"}	[]	\N
22222222-2222-2222-2222-222222220004	11111111-1111-1111-1111-111111111002	2026-02-04 10:00:00+00	\N	\N	{"sector": "Financeiro"}	[]	\N
22222222-2222-2222-2222-222222220005	11111111-1111-1111-1111-111111111002	2026-02-09 10:00:00+00	\N	\N	{"sector": "Financeiro"}	[]	\N
22222222-2222-2222-2222-222222220006	11111111-1111-1111-1111-111111111002	2026-02-14 10:00:00+00	\N	\N	{"sector": "Financeiro"}	[]	\N
33333333-3333-3333-3333-333333330001	11111111-1111-1111-1111-111111111003	2026-02-03 11:00:00+00	\N	\N	{"sector": "Operacoes"}	[]	\N
33333333-3333-3333-3333-333333330002	11111111-1111-1111-1111-111111111003	2026-02-08 11:00:00+00	\N	\N	{"sector": "Operacoes"}	[]	\N
33333333-3333-3333-3333-333333330003	11111111-1111-1111-1111-111111111003	2026-02-13 11:00:00+00	\N	\N	{"sector": "Operacoes"}	[]	\N
33333333-3333-3333-3333-333333330004	11111111-1111-1111-1111-111111111003	2026-02-05 11:00:00+00	\N	\N	{"sector": "Manutencao"}	[]	\N
33333333-3333-3333-3333-333333330005	11111111-1111-1111-1111-111111111003	2026-02-10 11:00:00+00	\N	\N	{"sector": "Manutencao"}	[]	\N
33333333-3333-3333-3333-333333330006	11111111-1111-1111-1111-111111111003	2026-02-15 11:00:00+00	\N	\N	{"sector": "Manutencao"}	[]	\N
44444444-4444-4444-4444-444444440001	11111111-1111-1111-1111-111111111004	2026-02-01 12:00:00+00	\N	\N	{"sector": "Comercial"}	[]	\N
44444444-4444-4444-4444-444444440002	11111111-1111-1111-1111-111111111004	2026-02-07 12:00:00+00	\N	\N	{"sector": "Comercial"}	[]	\N
44444444-4444-4444-4444-444444440003	11111111-1111-1111-1111-111111111004	2026-02-12 12:00:00+00	\N	\N	{"sector": "Comercial"}	[]	\N
44444444-4444-4444-4444-444444440004	11111111-1111-1111-1111-111111111004	2026-02-04 12:00:00+00	\N	\N	{"sector": "Atendimento"}	[]	\N
44444444-4444-4444-4444-444444440005	11111111-1111-1111-1111-111111111004	2026-02-09 12:00:00+00	\N	\N	{"sector": "Atendimento"}	[]	\N
44444444-4444-4444-4444-444444440006	11111111-1111-1111-1111-111111111004	2026-02-16 12:00:00+00	\N	\N	{"sector": "Atendimento"}	[]	\N
36b36900-c8c1-63d4-3e65-13ef87745c2a	11111111-1111-1111-1111-111111111020	2026-03-01 09:00:00+00	2daffb04-e3de-a5be-917c-dc61c2ad09a1	\N	{"role": "analista", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
656786cd-8514-b47c-6f96-065f94109adb	11111111-1111-1111-1111-111111111020	2026-03-01 15:00:00+00	c2eb0357-7ae0-7800-a80b-1fec530c1482	\N	{"role": "analista", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
c834d036-59a2-d3ab-ea4a-017901d9eaea	11111111-1111-1111-1111-111111111020	2026-03-01 21:00:00+00	d3eb66b0-fc77-13aa-2287-550b86126f5f	\N	{"role": "analista", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
8c4b850a-b284-2bf8-667f-35861a5d6ab8	11111111-1111-1111-1111-111111111020	2026-03-02 03:00:00+00	dcbdc837-2aed-0615-ee7b-aef7118b2788	\N	{"role": "lideranca", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	11111111-1111-1111-1111-111111111020	2026-03-02 09:00:00+00	3f7e1a7e-3ee2-5a7f-420e-8b9195462a2c	\N	{"role": "analista", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
9973793a-cd4b-00a4-8364-0086ca3e798e	11111111-1111-1111-1111-111111111020	2026-03-02 15:00:00+00	089e43f4-880d-3f50-3166-1b77d4d8027a	\N	{"role": "analista", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
f46e8f43-d615-2986-0344-50e7224bfc26	11111111-1111-1111-1111-111111111020	2026-03-02 21:00:00+00	af08854a-e32e-5ea7-8c34-b85bfaed31c5	\N	{"role": "analista", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
6cf4c03e-56f1-fe19-3140-b599811f1ce8	11111111-1111-1111-1111-111111111020	2026-03-03 03:00:00+00	2cdfa34c-ab26-9a95-6fe1-bb1d5f3f923b	\N	{"role": "lideranca", "sector": "Tecnologia", "sector_key": "tecnologia"}	[{"value": 2.5200, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4100, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.3400, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.7300, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.5500, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7300, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.6600, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.5900, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5200, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8000, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7700, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.1600, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.9100, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0200, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7000, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6300, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.5600, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.4900, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.4700, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.7500, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.3200, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3100, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.2400, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.8300, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.5500, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.5800, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5100, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.4400, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.6300, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 2.0500, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.1200, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1900, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3600, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.4300, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.1500, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.2200, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.3400, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.4100, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4800, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8000, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6700, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.7400, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.1900, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.6300, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.3500, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.4200, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5100, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 4.0100, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0800, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2000, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000001
61851fde-9d04-f90c-0996-0ba53df2a0c2	11111111-1111-1111-1111-111111111020	2026-03-03 09:00:00+00	fdc05cfa-81ab-031e-0dd8-56117da62e8c	\N	{"role": "analista", "sector": "Financeiro", "sector_key": "financeiro"}	[{"value": 2.4600, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4700, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4000, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6700, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6100, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7900, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7200, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.6500, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5800, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8600, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7100, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2200, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.8500, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0800, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7600, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6900, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6200, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.5500, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5300, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8100, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2600, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3700, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3000, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7700, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4900, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.6400, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5700, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5000, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5700, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9900, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0600, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1300, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3000, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3700, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0900, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1600, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2800, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.3500, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4200, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8600, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6100, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6800, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.2500, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5700, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2900, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3600, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5700, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.9500, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0200, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2600, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000002
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	11111111-1111-1111-1111-111111111020	2026-03-03 15:00:00+00	1511188f-b9fb-5dc7-abea-5664bac96b3f	\N	{"role": "analista", "sector": "Financeiro", "sector_key": "financeiro"}	[{"value": 2.4600, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4700, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4000, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6700, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6100, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7900, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7200, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.6500, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5800, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8600, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7100, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2200, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.8500, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0800, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7600, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6900, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6200, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.5500, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5300, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8100, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2600, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3700, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3000, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7700, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4900, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.6400, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5700, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5000, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5700, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9900, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0600, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1300, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3000, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3700, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0900, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1600, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2800, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.3500, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4200, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8600, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6100, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6800, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.2500, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5700, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2900, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3600, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5700, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.9500, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0200, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2600, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000002
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	11111111-1111-1111-1111-111111111020	2026-03-03 21:00:00+00	4e3c3c80-0f21-f117-25d0-a415ecac9862	\N	{"role": "analista", "sector": "Financeiro", "sector_key": "financeiro"}	[{"value": 2.4600, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4700, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4000, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6700, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6100, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7900, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7200, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.6500, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5800, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8600, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7100, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2200, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.8500, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0800, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7600, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6900, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6200, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.5500, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5300, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8100, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2600, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3700, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3000, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7700, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4900, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.6400, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5700, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5000, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5700, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9900, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0600, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1300, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3000, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3700, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0900, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1600, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2800, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.3500, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4200, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8600, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6100, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6800, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.2500, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5700, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2900, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3600, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5700, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.9500, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0200, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2600, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000002
a849956e-7811-2cf2-0249-947be4da877b	11111111-1111-1111-1111-111111111020	2026-03-04 03:00:00+00	5dd16778-0c80-3874-3b87-28aee9e4f94b	\N	{"role": "lideranca", "sector": "Financeiro", "sector_key": "financeiro"}	[{"value": 2.4600, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4700, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4000, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6700, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6100, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7900, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7200, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.6500, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5800, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8600, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7100, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2200, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.8500, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0800, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7600, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6900, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6200, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.5500, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5300, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8100, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2600, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3700, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3000, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7700, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4900, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.6400, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5700, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5000, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5700, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9900, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0600, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1300, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3000, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3700, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0900, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1600, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2800, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.3500, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4200, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8600, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6100, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6800, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.2500, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5700, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2900, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3600, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5700, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.9500, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0200, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2600, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000002
c783c180-be8e-9597-cd13-3bb1dc5d25a2	11111111-1111-1111-1111-111111111020	2026-03-04 09:00:00+00	f52203a3-abfd-ccab-a8fd-755dd06841a8	\N	{"role": "analista", "sector": "Financeiro", "sector_key": "financeiro"}	[{"value": 2.4600, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4700, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4000, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6700, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6100, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7900, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7200, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.6500, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5800, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8600, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7100, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2200, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.8500, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0800, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7600, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6900, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6200, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.5500, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5300, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8100, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2600, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3700, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3000, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7700, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4900, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.6400, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5700, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5000, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5700, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9900, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0600, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1300, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3000, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3700, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0900, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1600, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2800, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.3500, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4200, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8600, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6100, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6800, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.2500, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5700, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2900, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3600, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5700, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.9500, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0200, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2600, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000002
c024386b-da24-1275-b30d-1d6bf078032b	11111111-1111-1111-1111-111111111020	2026-03-04 15:00:00+00	c7c4e216-3daa-e04d-1e44-3f1d2390129f	\N	{"role": "analista", "sector": "Financeiro", "sector_key": "financeiro"}	[{"value": 2.4600, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.4700, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4000, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6700, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6100, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.7900, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7200, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.6500, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.5800, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.8600, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.7100, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2200, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.8500, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.0800, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.7600, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.6900, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6200, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.5500, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5300, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8100, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2600, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.3700, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3000, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7700, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4900, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.6400, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.5700, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5000, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5700, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9900, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0600, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.1300, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.3000, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3700, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0900, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1600, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2800, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.3500, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.4200, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.8600, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.6100, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6800, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.2500, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5700, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2900, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3600, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.5700, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.9500, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 4.0200, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.2600, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000002
d01fcbb0-ae33-fb93-f25e-01fde9d73768	11111111-1111-1111-1111-111111111020	2026-03-04 21:00:00+00	c9939f2b-d407-11d8-0708-c4668f360ca3	\N	{"role": "analista", "sector": "Comercial", "sector_key": "comercial"}	[{"value": 2.4000, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.5300, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4600, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6100, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6700, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.8500, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7800, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.7100, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.6400, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.9200, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.6500, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2800, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.7900, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.1400, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.8200, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.7500, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6800, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.6100, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5900, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8700, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2000, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.4300, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3600, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7100, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4300, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.7000, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.6300, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5600, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5100, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9300, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0000, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.0700, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.2400, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3100, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0300, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1000, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2200, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.2900, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.3600, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.9200, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.5500, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6200, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.3100, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5100, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2300, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3000, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.6300, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.8900, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 3.9600, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.3200, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000003
31ae731a-77d0-f452-e7c7-d45107c50613	11111111-1111-1111-1111-111111111020	2026-03-05 03:00:00+00	1e5e0f68-6dd4-f3af-8619-7a3b22d07426	\N	{"role": "lideranca", "sector": "Comercial", "sector_key": "comercial"}	[{"value": 2.4000, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.5300, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4600, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6100, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6700, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.8500, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7800, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.7100, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.6400, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.9200, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.6500, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2800, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.7900, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.1400, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.8200, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.7500, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6800, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.6100, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5900, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8700, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2000, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.4300, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3600, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7100, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4300, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.7000, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.6300, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5600, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5100, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9300, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0000, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.0700, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.2400, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3100, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0300, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1000, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2200, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.2900, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.3600, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.9200, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.5500, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6200, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.3100, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5100, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2300, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3000, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.6300, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.8900, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 3.9600, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.3200, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000003
488b2025-d0e1-a974-11da-b07b42cce96f	11111111-1111-1111-1111-111111111020	2026-03-05 09:00:00+00	5bd34603-4621-d262-b7c6-39a297a50b35	\N	{"role": "analista", "sector": "Comercial", "sector_key": "comercial"}	[{"value": 2.4000, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.5300, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4600, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6100, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6700, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.8500, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7800, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.7100, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.6400, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.9200, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.6500, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2800, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.7900, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.1400, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.8200, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.7500, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6800, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.6100, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5900, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8700, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2000, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.4300, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3600, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7100, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4300, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.7000, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.6300, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5600, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5100, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9300, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0000, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.0700, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.2400, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3100, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0300, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1000, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2200, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.2900, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.3600, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.9200, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.5500, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6200, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.3100, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5100, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2300, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3000, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.6300, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.8900, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 3.9600, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.3200, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000003
91c24e41-5149-5dae-ba22-b9708ae23035	11111111-1111-1111-1111-111111111020	2026-03-05 15:00:00+00	a8cc2fc1-dc3c-d1f0-2810-f17163ebe758	\N	{"role": "analista", "sector": "Comercial", "sector_key": "comercial"}	[{"value": 2.4000, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.5300, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4600, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6100, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6700, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.8500, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7800, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.7100, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.6400, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.9200, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.6500, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2800, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.7900, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.1400, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.8200, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.7500, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6800, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.6100, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5900, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8700, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2000, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.4300, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3600, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7100, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4300, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.7000, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.6300, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5600, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5100, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9300, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0000, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.0700, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.2400, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3100, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0300, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1000, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2200, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.2900, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.3600, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.9200, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.5500, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6200, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.3100, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5100, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2300, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3000, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.6300, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.8900, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 3.9600, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.3200, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000003
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	11111111-1111-1111-1111-111111111020	2026-03-05 21:00:00+00	2d6b70c7-7f9a-73f5-5fe4-bce64245b81b	\N	{"role": "analista", "sector": "Comercial", "sector_key": "comercial"}	[{"value": 2.4000, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.5300, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4600, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6100, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6700, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.8500, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7800, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.7100, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.6400, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.9200, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.6500, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2800, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.7900, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.1400, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.8200, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.7500, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6800, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.6100, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5900, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8700, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2000, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.4300, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3600, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7100, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4300, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.7000, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.6300, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5600, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5100, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9300, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0000, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.0700, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.2400, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3100, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0300, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1000, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2200, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.2900, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.3600, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.9200, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.5500, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6200, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.3100, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5100, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2300, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3000, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.6300, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.8900, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 3.9600, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.3200, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000003
681e4e24-4b0d-17b2-325f-ef92cacd1de4	11111111-1111-1111-1111-111111111020	2026-03-06 03:00:00+00	a2d432a2-069e-d88d-e67f-bbca2c2ffe10	\N	{"role": "lideranca", "sector": "Comercial", "sector_key": "comercial"}	[{"value": 2.4000, "question_id": "f214b9e4-74d3-4702-982c-40b5d951be9b"}, {"value": 3.5300, "question_id": "278211e4-339c-4a8b-a448-efcca33afe55"}, {"value": 3.4600, "question_id": "d325d6b7-564e-46df-b949-357fff1fc3d6"}, {"value": 2.6100, "question_id": "7e138529-c13c-4ea6-b933-45c3e81e87fb"}, {"value": 3.6700, "question_id": "4bc594fe-18d8-44b2-ad86-f69d715640d0"}, {"value": 3.8500, "question_id": "c9fe1fea-8591-42ec-93cd-aa119bb21678"}, {"value": 3.7800, "question_id": "3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1"}, {"value": 3.7100, "question_id": "4aa86b8d-4686-4b7f-a8d8-ca812129f5a6"}, {"value": 3.6400, "question_id": "e4406d81-f759-4171-9783-b6921bb2aac0"}, {"value": 3.9200, "question_id": "d1c80a85-50d5-4b2c-b39f-6e7e62e70836"}, {"value": 2.6500, "question_id": "5e4564a0-33c5-4682-8d23-2d15d8515b45"}, {"value": 3.2800, "question_id": "b7019767-d2b1-41d3-9348-1882e3118cfb"}, {"value": 2.7900, "question_id": "a57df58a-8cdb-446c-a741-490e1c07307f"}, {"value": 3.1400, "question_id": "bb7c6e53-ff9c-4402-bdcd-a9ba35209d81"}, {"value": 3.8200, "question_id": "1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c"}, {"value": 3.7500, "question_id": "c85a8f16-759e-40b9-9158-2b4d66c497cb"}, {"value": 3.6800, "question_id": "49e93d72-84f2-436b-aefa-e63eb1108a61"}, {"value": 3.6100, "question_id": "020c801a-be94-44fb-987a-8b71d2a5faa9"}, {"value": 3.5900, "question_id": "49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e"}, {"value": 3.8700, "question_id": "32851994-90c8-46f1-ae9f-df99830b56b5"}, {"value": 2.2000, "question_id": "30ee0b44-cdba-4bbe-a30c-347cd393eed1"}, {"value": 3.4300, "question_id": "8d355c2a-1fd0-48c0-8195-922fce9e1b7d"}, {"value": 3.3600, "question_id": "08f6c270-1667-4635-9494-b1f31ddbf21e"}, {"value": 2.7100, "question_id": "efa02eb3-6e98-4010-bb1f-5c401bb754d2"}, {"value": 2.4300, "question_id": "61e9581e-9948-4406-a037-b8a3c5a44854"}, {"value": 3.7000, "question_id": "1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7"}, {"value": 3.6300, "question_id": "b56d32fb-ca6b-4ae5-8f51-3984a25a0a96"}, {"value": 3.5600, "question_id": "32d9ce60-90ea-4728-95bf-4e00e01103dc"}, {"value": 2.5100, "question_id": "b5017f83-9c68-4824-ad35-481f48085589"}, {"value": 1.9300, "question_id": "09611139-e4a6-4690-8547-4b9f597948d5"}, {"value": 2.0000, "question_id": "6708cca7-6416-45c6-84d4-fad93d09dc67"}, {"value": 2.0700, "question_id": "a667bfa7-869f-4097-b2ea-a579617f2891"}, {"value": 2.2400, "question_id": "37a36fda-b2c4-41e4-aa06-031a4c2717f8"}, {"value": 2.3100, "question_id": "8a2a99f3-7f53-4098-a815-c36e4f63db8a"}, {"value": 2.0300, "question_id": "c0b474aa-0311-4eda-8b4b-85d41965e0ca"}, {"value": 2.1000, "question_id": "fb6ded29-0e78-4e05-8db0-eeefa3c76144"}, {"value": 4.2200, "question_id": "5770d367-fead-49c9-8d2d-2c272f24067e"}, {"value": 4.2900, "question_id": "886c8b7a-42bd-4aef-9d14-de197ae41c10"}, {"value": 4.3600, "question_id": "fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce"}, {"value": 1.9200, "question_id": "7a635620-d5af-4403-8ea2-1efbc61900a0"}, {"value": 2.5500, "question_id": "fbe80075-8a2c-47d8-a5e0-72e542ff6531"}, {"value": 2.6200, "question_id": "6febb11f-21d1-41ef-a1bc-ee814c70aea0"}, {"value": 3.3100, "question_id": "0be4464d-c3dd-4048-9fda-5cd4e5b71630"}, {"value": 3.5100, "question_id": "77e1f23a-e5bb-43da-a708-8ef4fef087ed"}, {"value": 3.2300, "question_id": "1a829301-36f0-49ea-880f-0bca7de67a1c"}, {"value": 3.3000, "question_id": "8ae04766-4a38-4bd0-94d3-5ba64f40c666"}, {"value": 2.6300, "question_id": "ada98e81-f09f-436c-b7a3-1350b0bb7c59"}, {"value": 3.8900, "question_id": "16528ff5-e872-43c8-9df5-96a02e4787c3"}, {"value": 3.9600, "question_id": "b01bf0cf-854e-422d-9d30-844098249d86"}, {"value": 2.3200, "question_id": "ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e"}]	77000000-0000-0000-0000-000000000003
\.


--
-- Data for Name: answers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."answers" ("response_id", "question_id", "raw_value", "corrected_value", "created_at") FROM stdin;
22222222-2222-2222-2222-222222220006	fa227ee2-829d-4d24-b65a-9f769a471169	2.3000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	7eb57d97-96a7-421a-ae95-9bfb540efcb2	3.6200	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	22b0c14c-8266-4e94-ab0d-90524adfed06	3.5400	2.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	2.2200	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	e7856868-6d88-4196-866c-d197941da4ee	3.7000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	fa227ee2-829d-4d24-b65a-9f769a471169	2.3800	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	7eb57d97-96a7-421a-ae95-9bfb540efcb2	3.5400	2.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	22b0c14c-8266-4e94-ab0d-90524adfed06	3.4600	2.5400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	2.3000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	e7856868-6d88-4196-866c-d197941da4ee	3.6200	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	fa227ee2-829d-4d24-b65a-9f769a471169	2.4800	2.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	7eb57d97-96a7-421a-ae95-9bfb540efcb2	3.4400	2.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	22b0c14c-8266-4e94-ab0d-90524adfed06	3.3600	2.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	2.4000	2.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	e7856868-6d88-4196-866c-d197941da4ee	3.5200	2.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	fa227ee2-829d-4d24-b65a-9f769a471169	2.2600	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	7eb57d97-96a7-421a-ae95-9bfb540efcb2	3.6600	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	22b0c14c-8266-4e94-ab0d-90524adfed06	3.5800	2.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	2.1800	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	e7856868-6d88-4196-866c-d197941da4ee	3.7400	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	fa227ee2-829d-4d24-b65a-9f769a471169	2.3400	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	7eb57d97-96a7-421a-ae95-9bfb540efcb2	3.5800	2.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	22b0c14c-8266-4e94-ab0d-90524adfed06	3.5000	2.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	2.2600	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	e7856868-6d88-4196-866c-d197941da4ee	3.6600	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	fa227ee2-829d-4d24-b65a-9f769a471169	2.4100	2.4100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	7eb57d97-96a7-421a-ae95-9bfb540efcb2	3.5100	2.4900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	22b0c14c-8266-4e94-ab0d-90524adfed06	3.4300	2.5700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	af6defa7-7658-4ba6-a4cb-f7cd2a99d00b	2.3300	2.3300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	e7856868-6d88-4196-866c-d197941da4ee	3.5900	2.4100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	5da3d90a-7c43-4601-bdea-592bfaf0e7ba	3.8200	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	3.7400	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	b5c31995-1fa3-4e1c-af85-f455824153ef	3.9800	2.0200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	5d8b725c-8446-4e77-a1fb-f6f71870e8a1	3.9000	2.1000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	54a6c32d-dd91-4677-85db-13ade5cd5f28	3.8200	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	5da3d90a-7c43-4601-bdea-592bfaf0e7ba	3.7400	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	3.6600	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	b5c31995-1fa3-4e1c-af85-f455824153ef	3.9000	2.1000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	5d8b725c-8446-4e77-a1fb-f6f71870e8a1	3.8200	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	54a6c32d-dd91-4677-85db-13ade5cd5f28	3.7400	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	5da3d90a-7c43-4601-bdea-592bfaf0e7ba	3.6400	2.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	3.5600	2.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	b5c31995-1fa3-4e1c-af85-f455824153ef	3.8000	2.2000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	5d8b725c-8446-4e77-a1fb-f6f71870e8a1	3.7200	2.2800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	54a6c32d-dd91-4677-85db-13ade5cd5f28	3.6400	2.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	5da3d90a-7c43-4601-bdea-592bfaf0e7ba	3.8600	2.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	3.7800	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	b5c31995-1fa3-4e1c-af85-f455824153ef	4.0200	1.9800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	5d8b725c-8446-4e77-a1fb-f6f71870e8a1	3.9400	2.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	54a6c32d-dd91-4677-85db-13ade5cd5f28	3.8600	2.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	5da3d90a-7c43-4601-bdea-592bfaf0e7ba	3.7800	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	3.7000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	b5c31995-1fa3-4e1c-af85-f455824153ef	3.9400	2.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	5d8b725c-8446-4e77-a1fb-f6f71870e8a1	3.8600	2.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	54a6c32d-dd91-4677-85db-13ade5cd5f28	3.7800	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	5da3d90a-7c43-4601-bdea-592bfaf0e7ba	3.7100	2.2900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	a491a9ad-e0dd-4ddc-a642-4fd6fcaf2092	3.6300	2.3700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	b5c31995-1fa3-4e1c-af85-f455824153ef	3.8700	2.1300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	5d8b725c-8446-4e77-a1fb-f6f71870e8a1	3.7900	2.2100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	54a6c32d-dd91-4677-85db-13ade5cd5f28	3.7100	2.2900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	502b89aa-6e38-4535-9a4f-37f2218dbc3e	2.9600	2.9600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	e775bafe-7b32-4dd7-9563-334494dee19c	3.2800	2.7200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	2.8000	2.8000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	9ad06b83-bfe3-4800-9fa4-4eacae61b778	3.1200	2.8800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	502b89aa-6e38-4535-9a4f-37f2218dbc3e	3.0400	3.0400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	e775bafe-7b32-4dd7-9563-334494dee19c	3.2000	2.8000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	2.8800	2.8800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	9ad06b83-bfe3-4800-9fa4-4eacae61b778	3.0400	2.9600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	502b89aa-6e38-4535-9a4f-37f2218dbc3e	3.1400	3.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	e775bafe-7b32-4dd7-9563-334494dee19c	3.1000	2.9000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	2.9800	2.9800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	9ad06b83-bfe3-4800-9fa4-4eacae61b778	2.9400	3.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	502b89aa-6e38-4535-9a4f-37f2218dbc3e	2.9200	2.9200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	e775bafe-7b32-4dd7-9563-334494dee19c	3.3200	2.6800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	2.7600	2.7600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	9ad06b83-bfe3-4800-9fa4-4eacae61b778	3.1600	2.8400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	502b89aa-6e38-4535-9a4f-37f2218dbc3e	3.0000	3.0000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	e775bafe-7b32-4dd7-9563-334494dee19c	3.2400	2.7600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	2.8400	2.8400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	9ad06b83-bfe3-4800-9fa4-4eacae61b778	3.0800	2.9200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	502b89aa-6e38-4535-9a4f-37f2218dbc3e	3.0700	3.0700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	e775bafe-7b32-4dd7-9563-334494dee19c	3.1700	2.8300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	62ecdd15-e698-48d1-bd7e-36b3e7fdb9b7	2.9100	2.9100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	9ad06b83-bfe3-4800-9fa4-4eacae61b778	3.0100	2.9900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	c89e499d-d0b5-4713-9375-02f398da80cd	3.4400	2.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	c0721650-1bdb-439b-8619-e80598f6c42c	3.6800	2.3200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	f288d8fd-0be1-414c-8351-ec8e8dfebeb4	3.6000	2.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	d1391709-bc62-46c3-a969-6d6bceb6fc14	3.5200	2.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	c89e499d-d0b5-4713-9375-02f398da80cd	3.3600	2.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	c0721650-1bdb-439b-8619-e80598f6c42c	3.6000	2.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	f288d8fd-0be1-414c-8351-ec8e8dfebeb4	3.5200	2.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	d1391709-bc62-46c3-a969-6d6bceb6fc14	3.4400	2.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	c89e499d-d0b5-4713-9375-02f398da80cd	3.2600	2.7400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	c0721650-1bdb-439b-8619-e80598f6c42c	3.5000	2.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	f288d8fd-0be1-414c-8351-ec8e8dfebeb4	3.4200	2.5800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	d1391709-bc62-46c3-a969-6d6bceb6fc14	3.3400	2.6600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	c89e499d-d0b5-4713-9375-02f398da80cd	3.4800	2.5200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	c0721650-1bdb-439b-8619-e80598f6c42c	3.7200	2.2800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	f288d8fd-0be1-414c-8351-ec8e8dfebeb4	3.6400	2.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	d1391709-bc62-46c3-a969-6d6bceb6fc14	3.5600	2.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	c89e499d-d0b5-4713-9375-02f398da80cd	3.4000	2.6000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	c0721650-1bdb-439b-8619-e80598f6c42c	3.6400	2.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	f288d8fd-0be1-414c-8351-ec8e8dfebeb4	3.5600	2.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	d1391709-bc62-46c3-a969-6d6bceb6fc14	3.4800	2.5200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	c89e499d-d0b5-4713-9375-02f398da80cd	3.3300	2.6700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	c0721650-1bdb-439b-8619-e80598f6c42c	3.5700	2.4300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	f288d8fd-0be1-414c-8351-ec8e8dfebeb4	3.4900	2.5100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	d1391709-bc62-46c3-a969-6d6bceb6fc14	3.4100	2.5900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	703a1653-c4ca-414c-82d1-46df9a0c52f8	3.6400	2.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	c6360468-cfbc-4122-bc6a-ac6b03dff854	3.8800	2.1200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	2.2000	2.2000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	703a1653-c4ca-414c-82d1-46df9a0c52f8	3.5600	2.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	c6360468-cfbc-4122-bc6a-ac6b03dff854	3.8000	2.2000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	2.2800	2.2800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	703a1653-c4ca-414c-82d1-46df9a0c52f8	3.4600	2.5400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	c6360468-cfbc-4122-bc6a-ac6b03dff854	3.7000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	2.3800	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	703a1653-c4ca-414c-82d1-46df9a0c52f8	3.6800	2.3200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	c6360468-cfbc-4122-bc6a-ac6b03dff854	3.9200	2.0800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	2.1600	2.1600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	703a1653-c4ca-414c-82d1-46df9a0c52f8	3.6000	2.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	c6360468-cfbc-4122-bc6a-ac6b03dff854	3.8400	2.1600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	2.2400	2.2400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	703a1653-c4ca-414c-82d1-46df9a0c52f8	3.5300	2.4700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	c6360468-cfbc-4122-bc6a-ac6b03dff854	3.7700	2.2300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	9dbefcb6-cfd4-4f3c-930c-dd2bcce9e6f8	2.3100	2.3100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	04214f99-8036-489b-b4f9-9ea6b8d71f68	3.4200	2.5800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	ed43de58-a0d4-4f66-b24c-0f3384d54151	3.3400	2.6600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	77139fe5-366a-46b8-9579-ce5092982354	2.4200	2.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	bdc178df-4905-4110-a4d2-e35ccf32f8fc	2.5000	2.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	04214f99-8036-489b-b4f9-9ea6b8d71f68	3.3400	2.6600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	ed43de58-a0d4-4f66-b24c-0f3384d54151	3.2600	2.7400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	77139fe5-366a-46b8-9579-ce5092982354	2.5000	2.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	bdc178df-4905-4110-a4d2-e35ccf32f8fc	2.5800	2.5800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	04214f99-8036-489b-b4f9-9ea6b8d71f68	3.2400	2.7600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	ed43de58-a0d4-4f66-b24c-0f3384d54151	3.1600	2.8400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	77139fe5-366a-46b8-9579-ce5092982354	2.6000	2.6000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	bdc178df-4905-4110-a4d2-e35ccf32f8fc	2.6800	2.6800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	04214f99-8036-489b-b4f9-9ea6b8d71f68	3.4600	2.5400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	ed43de58-a0d4-4f66-b24c-0f3384d54151	3.3800	2.6200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	77139fe5-366a-46b8-9579-ce5092982354	2.3800	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	bdc178df-4905-4110-a4d2-e35ccf32f8fc	2.4600	2.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	04214f99-8036-489b-b4f9-9ea6b8d71f68	3.3800	2.6200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	ed43de58-a0d4-4f66-b24c-0f3384d54151	3.3000	2.7000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	77139fe5-366a-46b8-9579-ce5092982354	2.4600	2.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	bdc178df-4905-4110-a4d2-e35ccf32f8fc	2.5400	2.5400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	04214f99-8036-489b-b4f9-9ea6b8d71f68	3.3100	2.6900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	ed43de58-a0d4-4f66-b24c-0f3384d54151	3.2300	2.7700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	77139fe5-366a-46b8-9579-ce5092982354	2.5300	2.5300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	bdc178df-4905-4110-a4d2-e35ccf32f8fc	2.6100	2.6100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	eb935899-1944-4a95-b3e9-5117792ff720	3.6200	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	513cc29b-1639-4c5e-aa75-5d0291384fbf	3.5400	2.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	a1217b01-53b4-4e60-9278-5ca1ac6efd99	3.7800	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	0dd75b17-6461-475f-b88b-af646eafd3e5	2.3000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	eb935899-1944-4a95-b3e9-5117792ff720	3.5400	2.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	513cc29b-1639-4c5e-aa75-5d0291384fbf	3.4600	2.5400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	a1217b01-53b4-4e60-9278-5ca1ac6efd99	3.7000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	0dd75b17-6461-475f-b88b-af646eafd3e5	2.3800	2.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	eb935899-1944-4a95-b3e9-5117792ff720	3.4400	2.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	513cc29b-1639-4c5e-aa75-5d0291384fbf	3.3600	2.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	a1217b01-53b4-4e60-9278-5ca1ac6efd99	3.6000	2.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	0dd75b17-6461-475f-b88b-af646eafd3e5	2.4800	2.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	eb935899-1944-4a95-b3e9-5117792ff720	3.6600	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	513cc29b-1639-4c5e-aa75-5d0291384fbf	3.5800	2.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	a1217b01-53b4-4e60-9278-5ca1ac6efd99	3.8200	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	0dd75b17-6461-475f-b88b-af646eafd3e5	2.2600	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	eb935899-1944-4a95-b3e9-5117792ff720	3.5800	2.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	513cc29b-1639-4c5e-aa75-5d0291384fbf	3.5000	2.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	a1217b01-53b4-4e60-9278-5ca1ac6efd99	3.7400	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	0dd75b17-6461-475f-b88b-af646eafd3e5	2.3400	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	eb935899-1944-4a95-b3e9-5117792ff720	3.5100	2.4900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	513cc29b-1639-4c5e-aa75-5d0291384fbf	3.4300	2.5700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	a1217b01-53b4-4e60-9278-5ca1ac6efd99	3.6700	2.3300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	0dd75b17-6461-475f-b88b-af646eafd3e5	2.4100	2.4100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	4678a6d3-121f-4e5f-879f-c98259dc22a4	1.9800	1.9800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	420b8356-678e-40be-9eed-c20dbcb4d4e7	2.0600	2.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	ed641033-fc30-49f2-bc5d-ffa50ee88bf9	1.8200	1.8200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	4678a6d3-121f-4e5f-879f-c98259dc22a4	2.0600	2.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	420b8356-678e-40be-9eed-c20dbcb4d4e7	2.1400	2.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	ed641033-fc30-49f2-bc5d-ffa50ee88bf9	1.9000	1.9000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	4678a6d3-121f-4e5f-879f-c98259dc22a4	2.1600	2.1600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	420b8356-678e-40be-9eed-c20dbcb4d4e7	2.2400	2.2400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	ed641033-fc30-49f2-bc5d-ffa50ee88bf9	2.0000	2.0000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	4678a6d3-121f-4e5f-879f-c98259dc22a4	1.9400	1.9400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	420b8356-678e-40be-9eed-c20dbcb4d4e7	2.0200	2.0200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	ed641033-fc30-49f2-bc5d-ffa50ee88bf9	1.7800	1.7800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	4678a6d3-121f-4e5f-879f-c98259dc22a4	2.0200	2.0200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	420b8356-678e-40be-9eed-c20dbcb4d4e7	2.1000	2.1000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	ed641033-fc30-49f2-bc5d-ffa50ee88bf9	1.8600	1.8600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	4678a6d3-121f-4e5f-879f-c98259dc22a4	2.0900	2.0900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	420b8356-678e-40be-9eed-c20dbcb4d4e7	2.1700	2.1700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	ed641033-fc30-49f2-bc5d-ffa50ee88bf9	1.9300	1.9300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	811aa622-3bbb-4096-bcb7-e78da1bc3ad3	2.1000	2.1000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	d8efe4be-dc17-4126-b007-bec54fc05d06	2.1800	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	393543c4-bd1e-4b60-9fa4-20131df0cc84	2.2600	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	ee81c937-be87-4090-baaf-df1e91f11b04	2.0200	2.0200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	811aa622-3bbb-4096-bcb7-e78da1bc3ad3	2.1800	2.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	d8efe4be-dc17-4126-b007-bec54fc05d06	2.2600	2.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	393543c4-bd1e-4b60-9fa4-20131df0cc84	2.3400	2.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	ee81c937-be87-4090-baaf-df1e91f11b04	2.1000	2.1000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	811aa622-3bbb-4096-bcb7-e78da1bc3ad3	2.2800	2.2800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	d8efe4be-dc17-4126-b007-bec54fc05d06	2.3600	2.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	393543c4-bd1e-4b60-9fa4-20131df0cc84	2.4400	2.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	ee81c937-be87-4090-baaf-df1e91f11b04	2.2000	2.2000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	811aa622-3bbb-4096-bcb7-e78da1bc3ad3	2.0600	2.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	d8efe4be-dc17-4126-b007-bec54fc05d06	2.1400	2.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	393543c4-bd1e-4b60-9fa4-20131df0cc84	2.2200	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	ee81c937-be87-4090-baaf-df1e91f11b04	1.9800	1.9800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	811aa622-3bbb-4096-bcb7-e78da1bc3ad3	2.1400	2.1400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	d8efe4be-dc17-4126-b007-bec54fc05d06	2.2200	2.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	393543c4-bd1e-4b60-9fa4-20131df0cc84	2.3000	2.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	ee81c937-be87-4090-baaf-df1e91f11b04	2.0600	2.0600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	811aa622-3bbb-4096-bcb7-e78da1bc3ad3	2.2100	2.2100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	d8efe4be-dc17-4126-b007-bec54fc05d06	2.2900	2.2900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	393543c4-bd1e-4b60-9fa4-20131df0cc84	2.3700	2.3700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	ee81c937-be87-4090-baaf-df1e91f11b04	2.1300	2.1300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	a52c0fd6-e633-4804-a634-21aaf56b829e	4.3000	4.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	4.3800	4.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	4b09cf47-9671-4223-b0ae-13ed1cb28053	4.4600	4.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	3741e4b0-2c50-4870-bd9b-a1058250910f	1.7800	4.2200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	a52c0fd6-e633-4804-a634-21aaf56b829e	4.3800	4.3800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	4.4600	4.4600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	4b09cf47-9671-4223-b0ae-13ed1cb28053	4.5400	4.5400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	3741e4b0-2c50-4870-bd9b-a1058250910f	1.7000	4.3000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	a52c0fd6-e633-4804-a634-21aaf56b829e	4.4800	4.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	4.5600	4.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	4b09cf47-9671-4223-b0ae-13ed1cb28053	4.6400	4.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	3741e4b0-2c50-4870-bd9b-a1058250910f	1.6000	4.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	a52c0fd6-e633-4804-a634-21aaf56b829e	4.2600	4.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	4.3400	4.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	4b09cf47-9671-4223-b0ae-13ed1cb28053	4.4200	4.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	3741e4b0-2c50-4870-bd9b-a1058250910f	1.8200	4.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	a52c0fd6-e633-4804-a634-21aaf56b829e	4.3400	4.3400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	4.4200	4.4200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	4b09cf47-9671-4223-b0ae-13ed1cb28053	4.5000	4.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	3741e4b0-2c50-4870-bd9b-a1058250910f	1.7400	4.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	a52c0fd6-e633-4804-a634-21aaf56b829e	4.4100	4.4100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	c90c3fd7-0e72-4fd4-a88d-fbaf190f0659	4.4900	4.4900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	4b09cf47-9671-4223-b0ae-13ed1cb28053	4.5700	4.5700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	3741e4b0-2c50-4870-bd9b-a1058250910f	1.6700	4.3300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	61d6125b-9d1b-4343-9e22-d92f6784643d	2.6000	2.6000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	2.6800	2.6800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	3.2400	2.7600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	61d6125b-9d1b-4343-9e22-d92f6784643d	2.6800	2.6800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	2.7600	2.7600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	3.1600	2.8400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	61d6125b-9d1b-4343-9e22-d92f6784643d	2.7800	2.7800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	2.8600	2.8600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	3.0600	2.9400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	61d6125b-9d1b-4343-9e22-d92f6784643d	2.5600	2.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	2.6400	2.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	3.2800	2.7200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	61d6125b-9d1b-4343-9e22-d92f6784643d	2.6400	2.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	2.7200	2.7200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	3.2000	2.8000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	61d6125b-9d1b-4343-9e22-d92f6784643d	2.7100	2.7100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	0bcc5793-2f71-4250-8e2d-1ce14d55e6a3	2.7900	2.7900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	d4abd3e6-8430-49c8-93d0-5581b6ca8a6e	3.1300	2.8700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	5923452c-9708-4f78-a19f-1cc1ac3f8d21	3.3200	3.3200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	33c5bb28-89b7-49b8-bb13-2eabef7c14fd	3.4000	3.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	43a91ee4-2a48-4669-ba17-f31547b03933	3.4800	3.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	449df3e2-8c09-453c-afe8-b44dcf499411	2.4400	3.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	5923452c-9708-4f78-a19f-1cc1ac3f8d21	3.4000	3.4000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	33c5bb28-89b7-49b8-bb13-2eabef7c14fd	3.4800	3.4800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	43a91ee4-2a48-4669-ba17-f31547b03933	3.5600	3.5600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	449df3e2-8c09-453c-afe8-b44dcf499411	2.3600	3.6400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	5923452c-9708-4f78-a19f-1cc1ac3f8d21	3.5000	3.5000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	33c5bb28-89b7-49b8-bb13-2eabef7c14fd	3.5800	3.5800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	43a91ee4-2a48-4669-ba17-f31547b03933	3.6600	3.6600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	449df3e2-8c09-453c-afe8-b44dcf499411	2.2600	3.7400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	5923452c-9708-4f78-a19f-1cc1ac3f8d21	3.2800	3.2800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	33c5bb28-89b7-49b8-bb13-2eabef7c14fd	3.3600	3.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	43a91ee4-2a48-4669-ba17-f31547b03933	3.4400	3.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	449df3e2-8c09-453c-afe8-b44dcf499411	2.4800	3.5200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	5923452c-9708-4f78-a19f-1cc1ac3f8d21	3.3600	3.3600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	33c5bb28-89b7-49b8-bb13-2eabef7c14fd	3.4400	3.4400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	43a91ee4-2a48-4669-ba17-f31547b03933	3.5200	3.5200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	449df3e2-8c09-453c-afe8-b44dcf499411	2.4000	3.6000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	5923452c-9708-4f78-a19f-1cc1ac3f8d21	3.4300	3.4300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	33c5bb28-89b7-49b8-bb13-2eabef7c14fd	3.5100	3.5100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	43a91ee4-2a48-4669-ba17-f31547b03933	3.5900	3.5900	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	449df3e2-8c09-453c-afe8-b44dcf499411	2.3300	3.6700	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	8bdf677a-6bea-4f63-8163-4da713e16246	3.9200	3.9200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	0adbd4cd-91bf-4a14-bb16-629eebd93a9f	4.0000	4.0000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220006	a0e877e9-7495-4f3f-913e-f4862c5a10ce	1.9200	4.0800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	8bdf677a-6bea-4f63-8163-4da713e16246	4.0000	4.0000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	0adbd4cd-91bf-4a14-bb16-629eebd93a9f	4.0800	4.0800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220005	a0e877e9-7495-4f3f-913e-f4862c5a10ce	1.8400	4.1600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	8bdf677a-6bea-4f63-8163-4da713e16246	4.1000	4.1000	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	0adbd4cd-91bf-4a14-bb16-629eebd93a9f	4.1800	4.1800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220004	a0e877e9-7495-4f3f-913e-f4862c5a10ce	1.7400	4.2600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	8bdf677a-6bea-4f63-8163-4da713e16246	3.8800	3.8800	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	0adbd4cd-91bf-4a14-bb16-629eebd93a9f	3.9600	3.9600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220003	a0e877e9-7495-4f3f-913e-f4862c5a10ce	1.9600	4.0400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	8bdf677a-6bea-4f63-8163-4da713e16246	3.9600	3.9600	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	0adbd4cd-91bf-4a14-bb16-629eebd93a9f	4.0400	4.0400	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220002	a0e877e9-7495-4f3f-913e-f4862c5a10ce	1.8800	4.1200	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	8bdf677a-6bea-4f63-8163-4da713e16246	4.0300	4.0300	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	0adbd4cd-91bf-4a14-bb16-629eebd93a9f	4.1100	4.1100	2026-03-01 20:44:43.786429+00
22222222-2222-2222-2222-222222220001	a0e877e9-7495-4f3f-913e-f4862c5a10ce	1.8100	4.1900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	597b2b64-285e-4c74-a051-a03b6d2b098c	3.2200	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	2.7000	3.3000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	d82b701c-f517-41cd-9502-bfc628ae34c8	2.6200	3.3800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	204766c8-cd09-40cb-9390-118420ec13a2	3.1400	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	2.7800	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	597b2b64-285e-4c74-a051-a03b6d2b098c	3.2600	3.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	2.6600	3.3400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	d82b701c-f517-41cd-9502-bfc628ae34c8	2.5800	3.4200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	204766c8-cd09-40cb-9390-118420ec13a2	3.1800	3.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	2.7400	3.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	597b2b64-285e-4c74-a051-a03b6d2b098c	3.3400	3.3400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	2.5800	3.4200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	d82b701c-f517-41cd-9502-bfc628ae34c8	2.5000	3.5000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	204766c8-cd09-40cb-9390-118420ec13a2	3.2600	3.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	2.6600	3.3400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	597b2b64-285e-4c74-a051-a03b6d2b098c	3.2300	3.2300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	2.6900	3.3100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	d82b701c-f517-41cd-9502-bfc628ae34c8	2.6100	3.3900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	204766c8-cd09-40cb-9390-118420ec13a2	3.1500	3.1500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	2.7700	3.2300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	597b2b64-285e-4c74-a051-a03b6d2b098c	3.3000	3.3000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	2.6200	3.3800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	d82b701c-f517-41cd-9502-bfc628ae34c8	2.5400	3.4600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	204766c8-cd09-40cb-9390-118420ec13a2	3.2200	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	2.7000	3.3000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	597b2b64-285e-4c74-a051-a03b6d2b098c	3.3600	3.3600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	13e1f0c1-d8d9-4eee-96d9-e1283a398e2c	2.5600	3.4400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	d82b701c-f517-41cd-9502-bfc628ae34c8	2.4800	3.5200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	204766c8-cd09-40cb-9390-118420ec13a2	3.2800	3.2800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	a65a017b-7dac-4be4-bfaa-349cfa5fcfb7	2.6400	3.3600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	0c780662-690d-4cb7-b0ce-7847accd58e7	3.0000	3.0000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	e6a61f45-2287-4c82-a113-093b1c51f99a	2.9200	3.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	9ea10479-74e2-451a-9bab-f73732b5a5b4	3.1600	2.8400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	2cff8649-d188-4ca2-ad01-257c7c6f4572	3.0800	2.9200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	2b010dcb-277f-4e71-bd4d-4ecfba6da696	3.0000	3.0000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	0c780662-690d-4cb7-b0ce-7847accd58e7	2.9600	3.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	e6a61f45-2287-4c82-a113-093b1c51f99a	2.8800	3.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	9ea10479-74e2-451a-9bab-f73732b5a5b4	3.1200	2.8800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	2cff8649-d188-4ca2-ad01-257c7c6f4572	3.0400	2.9600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	2b010dcb-277f-4e71-bd4d-4ecfba6da696	2.9600	3.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	0c780662-690d-4cb7-b0ce-7847accd58e7	2.8800	3.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	e6a61f45-2287-4c82-a113-093b1c51f99a	2.8000	3.2000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	9ea10479-74e2-451a-9bab-f73732b5a5b4	3.0400	2.9600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	2cff8649-d188-4ca2-ad01-257c7c6f4572	2.9600	3.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	2b010dcb-277f-4e71-bd4d-4ecfba6da696	2.8800	3.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	0c780662-690d-4cb7-b0ce-7847accd58e7	2.9900	3.0100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	e6a61f45-2287-4c82-a113-093b1c51f99a	2.9100	3.0900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	9ea10479-74e2-451a-9bab-f73732b5a5b4	3.1500	2.8500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	2cff8649-d188-4ca2-ad01-257c7c6f4572	3.0700	2.9300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	2b010dcb-277f-4e71-bd4d-4ecfba6da696	2.9900	3.0100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	0c780662-690d-4cb7-b0ce-7847accd58e7	2.9200	3.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	e6a61f45-2287-4c82-a113-093b1c51f99a	2.8400	3.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	9ea10479-74e2-451a-9bab-f73732b5a5b4	3.0800	2.9200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	2cff8649-d188-4ca2-ad01-257c7c6f4572	3.0000	3.0000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	2b010dcb-277f-4e71-bd4d-4ecfba6da696	2.9200	3.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	0c780662-690d-4cb7-b0ce-7847accd58e7	2.8600	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	e6a61f45-2287-4c82-a113-093b1c51f99a	2.7800	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	9ea10479-74e2-451a-9bab-f73732b5a5b4	3.0200	2.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	2cff8649-d188-4ca2-ad01-257c7c6f4572	2.9400	3.0600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	2b010dcb-277f-4e71-bd4d-4ecfba6da696	2.8600	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	f1ffd4dc-dcba-4b92-96f0-a61311b50014	3.1800	3.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	d830cf68-47a2-4b03-b2a8-353502d2841d	3.0600	2.9400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	86a8afe3-c11e-4425-bc95-0a43345386ae	3.0200	3.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	707ceae0-ff38-4751-92b3-446a7b517b1d	2.9000	3.1000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	f1ffd4dc-dcba-4b92-96f0-a61311b50014	3.2200	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	d830cf68-47a2-4b03-b2a8-353502d2841d	3.0200	2.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	86a8afe3-c11e-4425-bc95-0a43345386ae	3.0600	3.0600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	707ceae0-ff38-4751-92b3-446a7b517b1d	2.8600	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	f1ffd4dc-dcba-4b92-96f0-a61311b50014	3.3000	3.3000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	d830cf68-47a2-4b03-b2a8-353502d2841d	2.9400	3.0600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	86a8afe3-c11e-4425-bc95-0a43345386ae	3.1400	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	707ceae0-ff38-4751-92b3-446a7b517b1d	2.7800	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	f1ffd4dc-dcba-4b92-96f0-a61311b50014	3.1900	3.1900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	d830cf68-47a2-4b03-b2a8-353502d2841d	3.0500	2.9500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	86a8afe3-c11e-4425-bc95-0a43345386ae	3.0300	3.0300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	707ceae0-ff38-4751-92b3-446a7b517b1d	2.8900	3.1100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	f1ffd4dc-dcba-4b92-96f0-a61311b50014	3.2600	3.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	d830cf68-47a2-4b03-b2a8-353502d2841d	2.9800	3.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	86a8afe3-c11e-4425-bc95-0a43345386ae	3.1000	3.1000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	707ceae0-ff38-4751-92b3-446a7b517b1d	2.8200	3.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	f1ffd4dc-dcba-4b92-96f0-a61311b50014	3.3200	3.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	d830cf68-47a2-4b03-b2a8-353502d2841d	2.9200	3.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	86a8afe3-c11e-4425-bc95-0a43345386ae	3.1600	3.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	707ceae0-ff38-4751-92b3-446a7b517b1d	2.7600	3.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	00cd032c-1ac3-4332-9cad-7b2bf0ff1def	3.2200	2.7800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	971246f4-407c-432b-baf6-6af963c20b93	3.4600	2.5400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	3.3800	2.6200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	2d084653-66bc-41dc-9dc8-f6ef8ca7af88	3.3000	2.7000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	00cd032c-1ac3-4332-9cad-7b2bf0ff1def	3.1800	2.8200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	971246f4-407c-432b-baf6-6af963c20b93	3.4200	2.5800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	3.3400	2.6600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	2d084653-66bc-41dc-9dc8-f6ef8ca7af88	3.2600	2.7400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	00cd032c-1ac3-4332-9cad-7b2bf0ff1def	3.1000	2.9000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	971246f4-407c-432b-baf6-6af963c20b93	3.3400	2.6600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	3.2600	2.7400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	2d084653-66bc-41dc-9dc8-f6ef8ca7af88	3.1800	2.8200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	00cd032c-1ac3-4332-9cad-7b2bf0ff1def	3.2100	2.7900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	971246f4-407c-432b-baf6-6af963c20b93	3.4500	2.5500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	3.3700	2.6300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	2d084653-66bc-41dc-9dc8-f6ef8ca7af88	3.2900	2.7100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	00cd032c-1ac3-4332-9cad-7b2bf0ff1def	3.1400	2.8600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	971246f4-407c-432b-baf6-6af963c20b93	3.3800	2.6200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	3.3000	2.7000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	2d084653-66bc-41dc-9dc8-f6ef8ca7af88	3.2200	2.7800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	00cd032c-1ac3-4332-9cad-7b2bf0ff1def	3.0800	2.9200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	971246f4-407c-432b-baf6-6af963c20b93	3.3200	2.6800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	cd587ab8-a1a8-4e07-a5b4-d1a41e9144ad	3.2400	2.7600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	2d084653-66bc-41dc-9dc8-f6ef8ca7af88	3.1600	2.8400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	3a511eaf-4a22-4924-92d0-1bc671c86371	3.1200	2.8800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	3.3600	2.6400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	7b9ec861-348a-4df3-9f34-a197b270f2ae	2.7200	2.7200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	3a511eaf-4a22-4924-92d0-1bc671c86371	3.0800	2.9200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	3.3200	2.6800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	7b9ec861-348a-4df3-9f34-a197b270f2ae	2.7600	2.7600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	3a511eaf-4a22-4924-92d0-1bc671c86371	3.0000	3.0000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	3.2400	2.7600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	7b9ec861-348a-4df3-9f34-a197b270f2ae	2.8400	2.8400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	3a511eaf-4a22-4924-92d0-1bc671c86371	3.1100	2.8900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	3.3500	2.6500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	7b9ec861-348a-4df3-9f34-a197b270f2ae	2.7300	2.7300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	3a511eaf-4a22-4924-92d0-1bc671c86371	3.0400	2.9600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	3.2800	2.7200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	7b9ec861-348a-4df3-9f34-a197b270f2ae	2.8000	2.8000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	3a511eaf-4a22-4924-92d0-1bc671c86371	2.9800	3.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	8fdd7d4b-6d78-42d5-aa78-4cce8f7689eb	3.2200	2.7800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	7b9ec861-348a-4df3-9f34-a197b270f2ae	2.8600	2.8600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	3.1000	2.9000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	3.0200	2.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	2.7400	2.7400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	070071c5-7927-4bd6-adf6-fdecfa689009	2.8200	2.8200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	3.0600	2.9400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	2.9800	3.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	2.7800	2.7800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	070071c5-7927-4bd6-adf6-fdecfa689009	2.8600	2.8600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	2.9800	3.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	2.9000	3.1000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	2.8600	2.8600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	070071c5-7927-4bd6-adf6-fdecfa689009	2.9400	2.9400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	3.0900	2.9100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	3.0100	2.9900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	2.7500	2.7500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	070071c5-7927-4bd6-adf6-fdecfa689009	2.8300	2.8300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	3.0200	2.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	2.9400	3.0600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	2.8200	2.8200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	070071c5-7927-4bd6-adf6-fdecfa689009	2.9000	2.9000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	de4d3af5-58f1-4124-bf08-1a7b3e9fdc79	2.9600	3.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	7a91dfa4-0a9b-4edf-a8aa-b1832c62db63	2.8800	3.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	a997ba1a-0a8c-4ca8-ba51-0d69c36cf1b2	2.8800	2.8800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	070071c5-7927-4bd6-adf6-fdecfa689009	2.9600	2.9600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	3.1200	3.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	71ab61c1-ab73-4e09-ade5-0da77b4d35b2	2.8000	3.2000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	a175b7b2-c5f8-4e09-93cc-28fa05afb991	2.7200	3.2800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	c0ab206f-94c4-4f80-bfff-2a2fce4828e5	2.9600	3.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	3.1600	3.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	71ab61c1-ab73-4e09-ade5-0da77b4d35b2	2.7600	3.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	a175b7b2-c5f8-4e09-93cc-28fa05afb991	2.6800	3.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	c0ab206f-94c4-4f80-bfff-2a2fce4828e5	2.9200	3.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	3.2400	3.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	71ab61c1-ab73-4e09-ade5-0da77b4d35b2	2.6800	3.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	a175b7b2-c5f8-4e09-93cc-28fa05afb991	2.6000	3.4000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	c0ab206f-94c4-4f80-bfff-2a2fce4828e5	2.8400	3.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	3.1300	3.1300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	71ab61c1-ab73-4e09-ade5-0da77b4d35b2	2.7900	3.2100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	a175b7b2-c5f8-4e09-93cc-28fa05afb991	2.7100	3.2900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	c0ab206f-94c4-4f80-bfff-2a2fce4828e5	2.9500	3.0500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	3.2000	3.2000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	71ab61c1-ab73-4e09-ade5-0da77b4d35b2	2.7200	3.2800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	a175b7b2-c5f8-4e09-93cc-28fa05afb991	2.6400	3.3600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	c0ab206f-94c4-4f80-bfff-2a2fce4828e5	2.8800	3.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	6aca3d7f-4bd8-4d89-8c8e-bd9aa005d1d4	3.2600	3.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	71ab61c1-ab73-4e09-ade5-0da77b4d35b2	2.6600	3.3400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	a175b7b2-c5f8-4e09-93cc-28fa05afb991	2.5800	3.4200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	c0ab206f-94c4-4f80-bfff-2a2fce4828e5	2.8200	3.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	3e1748d8-8c2c-467c-adbc-8ba87c8bd442	4.0000	4.0000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	3738963a-8326-4fb5-b77a-2478b07be378	4.0800	4.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	19c3570a-b1e4-415f-b2e6-9008459e40dd	3.8400	3.8400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	3e1748d8-8c2c-467c-adbc-8ba87c8bd442	4.0400	4.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	3738963a-8326-4fb5-b77a-2478b07be378	4.1200	4.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	19c3570a-b1e4-415f-b2e6-9008459e40dd	3.8800	3.8800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	3e1748d8-8c2c-467c-adbc-8ba87c8bd442	4.1200	4.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	3738963a-8326-4fb5-b77a-2478b07be378	4.2000	4.2000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	19c3570a-b1e4-415f-b2e6-9008459e40dd	3.9600	3.9600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	3e1748d8-8c2c-467c-adbc-8ba87c8bd442	4.0100	4.0100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	3738963a-8326-4fb5-b77a-2478b07be378	4.0900	4.0900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	19c3570a-b1e4-415f-b2e6-9008459e40dd	3.8500	3.8500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	3e1748d8-8c2c-467c-adbc-8ba87c8bd442	4.0800	4.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	3738963a-8326-4fb5-b77a-2478b07be378	4.1600	4.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	19c3570a-b1e4-415f-b2e6-9008459e40dd	3.9200	3.9200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	3e1748d8-8c2c-467c-adbc-8ba87c8bd442	4.1400	4.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	3738963a-8326-4fb5-b77a-2478b07be378	4.2200	4.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	19c3570a-b1e4-415f-b2e6-9008459e40dd	3.9800	3.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	e4604f2a-4c6d-4a7e-a985-7d70bb857c57	2.3200	2.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	e2d1c78f-19e2-4aa2-b523-776e558191d4	2.4000	2.4000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	a65aecba-2bc9-43a5-be5d-412d495a3705	2.4800	2.4800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	3cad095c-270c-4de0-8ba3-4c1dfd497c23	2.2400	2.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	e4604f2a-4c6d-4a7e-a985-7d70bb857c57	2.3600	2.3600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	e2d1c78f-19e2-4aa2-b523-776e558191d4	2.4400	2.4400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	a65aecba-2bc9-43a5-be5d-412d495a3705	2.5200	2.5200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	3cad095c-270c-4de0-8ba3-4c1dfd497c23	2.2800	2.2800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	e4604f2a-4c6d-4a7e-a985-7d70bb857c57	2.4400	2.4400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	e2d1c78f-19e2-4aa2-b523-776e558191d4	2.5200	2.5200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	a65aecba-2bc9-43a5-be5d-412d495a3705	2.6000	2.6000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	3cad095c-270c-4de0-8ba3-4c1dfd497c23	2.3600	2.3600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	e4604f2a-4c6d-4a7e-a985-7d70bb857c57	2.3300	2.3300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	e2d1c78f-19e2-4aa2-b523-776e558191d4	2.4100	2.4100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	a65aecba-2bc9-43a5-be5d-412d495a3705	2.4900	2.4900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	3cad095c-270c-4de0-8ba3-4c1dfd497c23	2.2500	2.2500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	e4604f2a-4c6d-4a7e-a985-7d70bb857c57	2.4000	2.4000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	e2d1c78f-19e2-4aa2-b523-776e558191d4	2.4800	2.4800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	a65aecba-2bc9-43a5-be5d-412d495a3705	2.5600	2.5600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	3cad095c-270c-4de0-8ba3-4c1dfd497c23	2.3200	2.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	e4604f2a-4c6d-4a7e-a985-7d70bb857c57	2.4600	2.4600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	e2d1c78f-19e2-4aa2-b523-776e558191d4	2.5400	2.5400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	a65aecba-2bc9-43a5-be5d-412d495a3705	2.6200	2.6200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	3cad095c-270c-4de0-8ba3-4c1dfd497c23	2.3800	2.3800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	3ec1b43f-e7cf-484d-9a56-4e589901ebc6	4.1200	4.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	364c8422-e75e-4300-b8f2-b6b11b4172c2	4.2000	4.2000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	4.2800	4.2800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	edfef766-6e1e-4f17-9070-2e04d1fbbc77	1.9600	4.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	3ec1b43f-e7cf-484d-9a56-4e589901ebc6	4.1600	4.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	364c8422-e75e-4300-b8f2-b6b11b4172c2	4.2400	4.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	4.3200	4.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	edfef766-6e1e-4f17-9070-2e04d1fbbc77	1.9200	4.0800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	3ec1b43f-e7cf-484d-9a56-4e589901ebc6	4.2400	4.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	364c8422-e75e-4300-b8f2-b6b11b4172c2	4.3200	4.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	4.4000	4.4000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	edfef766-6e1e-4f17-9070-2e04d1fbbc77	1.8400	4.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	3ec1b43f-e7cf-484d-9a56-4e589901ebc6	4.1300	4.1300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	364c8422-e75e-4300-b8f2-b6b11b4172c2	4.2100	4.2100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	4.2900	4.2900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	edfef766-6e1e-4f17-9070-2e04d1fbbc77	1.9500	4.0500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	3ec1b43f-e7cf-484d-9a56-4e589901ebc6	4.2000	4.2000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	364c8422-e75e-4300-b8f2-b6b11b4172c2	4.2800	4.2800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	4.3600	4.3600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	edfef766-6e1e-4f17-9070-2e04d1fbbc77	1.8800	4.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	3ec1b43f-e7cf-484d-9a56-4e589901ebc6	4.2600	4.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	364c8422-e75e-4300-b8f2-b6b11b4172c2	4.3400	4.3400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	bcb9dc3f-25f9-4e1e-b01d-cba5c683b105	4.4200	4.4200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	edfef766-6e1e-4f17-9070-2e04d1fbbc77	1.8200	4.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	bcdddfab-8c04-4282-8f7f-c18116652afd	3.0200	3.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	07730b2b-df11-4806-a053-705038165e7b	3.1000	3.1000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	b8b1a178-760f-4c71-97c6-12aada83de6a	2.8200	3.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	bcdddfab-8c04-4282-8f7f-c18116652afd	3.0600	3.0600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	07730b2b-df11-4806-a053-705038165e7b	3.1400	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	b8b1a178-760f-4c71-97c6-12aada83de6a	2.7800	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	bcdddfab-8c04-4282-8f7f-c18116652afd	3.1400	3.1400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	07730b2b-df11-4806-a053-705038165e7b	3.2200	3.2200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	b8b1a178-760f-4c71-97c6-12aada83de6a	2.7000	3.3000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	bcdddfab-8c04-4282-8f7f-c18116652afd	3.0300	3.0300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	07730b2b-df11-4806-a053-705038165e7b	3.1100	3.1100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	b8b1a178-760f-4c71-97c6-12aada83de6a	2.8100	3.1900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	bcdddfab-8c04-4282-8f7f-c18116652afd	3.1000	3.1000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	07730b2b-df11-4806-a053-705038165e7b	3.1800	3.1800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	b8b1a178-760f-4c71-97c6-12aada83de6a	2.7400	3.2600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	bcdddfab-8c04-4282-8f7f-c18116652afd	3.1600	3.1600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	07730b2b-df11-4806-a053-705038165e7b	3.2400	3.2400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	b8b1a178-760f-4c71-97c6-12aada83de6a	2.6800	3.3200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	a81bf3fd-93dc-4856-b585-2a4ece018841	3.7400	3.7400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	3.8200	3.8200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	9969acc9-e3ec-42e1-9053-425d2a7057cf	3.9000	3.9000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	ac5e7c06-988c-4938-b39f-64ed27db8170	2.0200	3.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	a81bf3fd-93dc-4856-b585-2a4ece018841	3.7800	3.7800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	3.8600	3.8600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	9969acc9-e3ec-42e1-9053-425d2a7057cf	3.9400	3.9400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	ac5e7c06-988c-4938-b39f-64ed27db8170	1.9800	4.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	a81bf3fd-93dc-4856-b585-2a4ece018841	3.8600	3.8600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	3.9400	3.9400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	9969acc9-e3ec-42e1-9053-425d2a7057cf	4.0200	4.0200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	ac5e7c06-988c-4938-b39f-64ed27db8170	1.9000	4.1000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	a81bf3fd-93dc-4856-b585-2a4ece018841	3.7500	3.7500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	3.8300	3.8300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	9969acc9-e3ec-42e1-9053-425d2a7057cf	3.9100	3.9100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	ac5e7c06-988c-4938-b39f-64ed27db8170	2.0100	3.9900	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	a81bf3fd-93dc-4856-b585-2a4ece018841	3.8200	3.8200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	3.9000	3.9000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	9969acc9-e3ec-42e1-9053-425d2a7057cf	3.9800	3.9800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	ac5e7c06-988c-4938-b39f-64ed27db8170	1.9400	4.0600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	a81bf3fd-93dc-4856-b585-2a4ece018841	3.8800	3.8800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	f06e2fa0-70e8-4aa7-8112-7f11d5d26e34	3.9600	3.9600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	9969acc9-e3ec-42e1-9053-425d2a7057cf	4.0400	4.0400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	ac5e7c06-988c-4938-b39f-64ed27db8170	1.8800	4.1200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	73228bdb-c235-4347-9d13-6335c95488db	2.4400	2.4400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	03abc67a-2368-4513-89d2-9312dfd3df57	2.5200	2.5200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330006	5276855b-adf4-4d86-bc75-5cbbaef5a33d	3.4000	2.6000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	73228bdb-c235-4347-9d13-6335c95488db	2.4800	2.4800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	03abc67a-2368-4513-89d2-9312dfd3df57	2.5600	2.5600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330005	5276855b-adf4-4d86-bc75-5cbbaef5a33d	3.3600	2.6400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	73228bdb-c235-4347-9d13-6335c95488db	2.5600	2.5600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	03abc67a-2368-4513-89d2-9312dfd3df57	2.6400	2.6400	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330004	5276855b-adf4-4d86-bc75-5cbbaef5a33d	3.2800	2.7200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	73228bdb-c235-4347-9d13-6335c95488db	2.4500	2.4500	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	03abc67a-2368-4513-89d2-9312dfd3df57	2.5300	2.5300	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330003	5276855b-adf4-4d86-bc75-5cbbaef5a33d	3.3900	2.6100	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	73228bdb-c235-4347-9d13-6335c95488db	2.5200	2.5200	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	03abc67a-2368-4513-89d2-9312dfd3df57	2.6000	2.6000	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330002	5276855b-adf4-4d86-bc75-5cbbaef5a33d	3.3200	2.6800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	73228bdb-c235-4347-9d13-6335c95488db	2.5800	2.5800	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	03abc67a-2368-4513-89d2-9312dfd3df57	2.6600	2.6600	2026-03-01 20:44:43.786429+00
33333333-3333-3333-3333-333333330001	5276855b-adf4-4d86-bc75-5cbbaef5a33d	3.2600	2.7400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	79a4bb77-c247-4107-9562-94cf1a9acc3c	4.0300	4.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	9848f7c1-1b26-4df9-bf10-0e302bc8701b	1.8900	4.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	96887867-e8bc-4ec9-8cb1-640549849afa	1.8100	4.1900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	5c8dd1f7-27a2-4a0e-b936-05769bd08107	3.9500	3.9500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	5684ac30-3300-4bdd-9da9-c6b3dd36278e	1.9700	4.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	79a4bb77-c247-4107-9562-94cf1a9acc3c	4.0900	4.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	9848f7c1-1b26-4df9-bf10-0e302bc8701b	1.8300	4.1700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	96887867-e8bc-4ec9-8cb1-640549849afa	1.7500	4.2500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	5c8dd1f7-27a2-4a0e-b936-05769bd08107	4.0100	4.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	5684ac30-3300-4bdd-9da9-c6b3dd36278e	1.9100	4.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	79a4bb77-c247-4107-9562-94cf1a9acc3c	4.1500	4.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	9848f7c1-1b26-4df9-bf10-0e302bc8701b	1.7700	4.2300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	96887867-e8bc-4ec9-8cb1-640549849afa	1.6900	4.3100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	5c8dd1f7-27a2-4a0e-b936-05769bd08107	4.0700	4.0700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	5684ac30-3300-4bdd-9da9-c6b3dd36278e	1.8500	4.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	79a4bb77-c247-4107-9562-94cf1a9acc3c	4.0100	4.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	9848f7c1-1b26-4df9-bf10-0e302bc8701b	1.9100	4.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	96887867-e8bc-4ec9-8cb1-640549849afa	1.8300	4.1700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	5c8dd1f7-27a2-4a0e-b936-05769bd08107	3.9300	3.9300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	5684ac30-3300-4bdd-9da9-c6b3dd36278e	1.9900	4.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	79a4bb77-c247-4107-9562-94cf1a9acc3c	4.0600	4.0600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	9848f7c1-1b26-4df9-bf10-0e302bc8701b	1.8600	4.1400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	96887867-e8bc-4ec9-8cb1-640549849afa	1.7800	4.2200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	5c8dd1f7-27a2-4a0e-b936-05769bd08107	3.9800	3.9800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	5684ac30-3300-4bdd-9da9-c6b3dd36278e	1.9400	4.0600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	79a4bb77-c247-4107-9562-94cf1a9acc3c	4.1300	4.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	9848f7c1-1b26-4df9-bf10-0e302bc8701b	1.7900	4.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	96887867-e8bc-4ec9-8cb1-640549849afa	1.7100	4.2900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	5c8dd1f7-27a2-4a0e-b936-05769bd08107	4.0500	4.0500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	5684ac30-3300-4bdd-9da9-c6b3dd36278e	1.8700	4.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	2.3900	3.6100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	94ae2787-86d4-41fd-84f9-a555a49f81fd	2.3100	3.6900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	ead35916-20d9-4c34-8492-7a5092c5cbf7	2.5500	3.4500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	bdffd3df-74a4-407f-9ab8-ca1f01b65af9	2.4700	3.5300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	e5a01657-96cc-44b5-a5f1-f74a39bc26bd	2.3900	3.6100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	2.3300	3.6700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	94ae2787-86d4-41fd-84f9-a555a49f81fd	2.2500	3.7500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	ead35916-20d9-4c34-8492-7a5092c5cbf7	2.4900	3.5100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	bdffd3df-74a4-407f-9ab8-ca1f01b65af9	2.4100	3.5900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	e5a01657-96cc-44b5-a5f1-f74a39bc26bd	2.3300	3.6700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	2.2700	3.7300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	94ae2787-86d4-41fd-84f9-a555a49f81fd	2.1900	3.8100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	ead35916-20d9-4c34-8492-7a5092c5cbf7	2.4300	3.5700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	bdffd3df-74a4-407f-9ab8-ca1f01b65af9	2.3500	3.6500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	e5a01657-96cc-44b5-a5f1-f74a39bc26bd	2.2700	3.7300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	2.4100	3.5900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	94ae2787-86d4-41fd-84f9-a555a49f81fd	2.3300	3.6700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	ead35916-20d9-4c34-8492-7a5092c5cbf7	2.5700	3.4300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	bdffd3df-74a4-407f-9ab8-ca1f01b65af9	2.4900	3.5100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	e5a01657-96cc-44b5-a5f1-f74a39bc26bd	2.4100	3.5900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	2.3600	3.6400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	94ae2787-86d4-41fd-84f9-a555a49f81fd	2.2800	3.7200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	ead35916-20d9-4c34-8492-7a5092c5cbf7	2.5200	3.4800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	bdffd3df-74a4-407f-9ab8-ca1f01b65af9	2.4400	3.5600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	e5a01657-96cc-44b5-a5f1-f74a39bc26bd	2.3600	3.6400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	d18f2c7d-d93c-44db-a8aa-0f9240a73c1a	2.2900	3.7100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	94ae2787-86d4-41fd-84f9-a555a49f81fd	2.2100	3.7900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	ead35916-20d9-4c34-8492-7a5092c5cbf7	2.4500	3.5500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	bdffd3df-74a4-407f-9ab8-ca1f01b65af9	2.3700	3.6300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	e5a01657-96cc-44b5-a5f1-f74a39bc26bd	2.2900	3.7100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	d5164075-c29a-4980-a14b-094a0fcb33af	3.0900	3.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	82bf517c-9c45-47c5-940d-e6ff2d38a068	3.1500	2.8500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	a9eb1224-9359-4dc2-848e-bf057e454bf3	2.9300	2.9300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	2.9900	3.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	d5164075-c29a-4980-a14b-094a0fcb33af	3.1500	3.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	82bf517c-9c45-47c5-940d-e6ff2d38a068	3.0900	2.9100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	a9eb1224-9359-4dc2-848e-bf057e454bf3	2.9900	2.9900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	2.9300	3.0700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	d5164075-c29a-4980-a14b-094a0fcb33af	3.2100	3.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	82bf517c-9c45-47c5-940d-e6ff2d38a068	3.0300	2.9700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	a9eb1224-9359-4dc2-848e-bf057e454bf3	3.0500	3.0500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	2.8700	3.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	d5164075-c29a-4980-a14b-094a0fcb33af	3.0700	3.0700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	82bf517c-9c45-47c5-940d-e6ff2d38a068	3.1700	2.8300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	a9eb1224-9359-4dc2-848e-bf057e454bf3	2.9100	2.9100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	3.0100	2.9900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	d5164075-c29a-4980-a14b-094a0fcb33af	3.1200	3.1200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	82bf517c-9c45-47c5-940d-e6ff2d38a068	3.1200	2.8800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	a9eb1224-9359-4dc2-848e-bf057e454bf3	2.9600	2.9600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	2.9600	3.0400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	d5164075-c29a-4980-a14b-094a0fcb33af	3.1900	3.1900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	82bf517c-9c45-47c5-940d-e6ff2d38a068	3.0500	2.9500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	a9eb1224-9359-4dc2-848e-bf057e454bf3	3.0300	3.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	ee29cb69-c3b6-4b50-9ad6-ad41dbe61d30	2.8900	3.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	6b4310fa-1063-427b-9767-cf495276268f	3.1100	2.8900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	de9395ef-ec7e-4366-b6f7-ec33753b76b7	3.3500	2.6500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	c1a74934-6cb6-4f33-908b-a5db71df99ce	3.2700	2.7300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	3.1900	2.8100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	6b4310fa-1063-427b-9767-cf495276268f	3.0500	2.9500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	de9395ef-ec7e-4366-b6f7-ec33753b76b7	3.2900	2.7100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	c1a74934-6cb6-4f33-908b-a5db71df99ce	3.2100	2.7900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	3.1300	2.8700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	6b4310fa-1063-427b-9767-cf495276268f	2.9900	3.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	de9395ef-ec7e-4366-b6f7-ec33753b76b7	3.2300	2.7700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	c1a74934-6cb6-4f33-908b-a5db71df99ce	3.1500	2.8500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	3.0700	2.9300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	6b4310fa-1063-427b-9767-cf495276268f	3.1300	2.8700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	de9395ef-ec7e-4366-b6f7-ec33753b76b7	3.3700	2.6300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	c1a74934-6cb6-4f33-908b-a5db71df99ce	3.2900	2.7100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	3.2100	2.7900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	6b4310fa-1063-427b-9767-cf495276268f	3.0800	2.9200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	de9395ef-ec7e-4366-b6f7-ec33753b76b7	3.3200	2.6800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	c1a74934-6cb6-4f33-908b-a5db71df99ce	3.2400	2.7600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	3.1600	2.8400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	6b4310fa-1063-427b-9767-cf495276268f	3.0100	2.9900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	de9395ef-ec7e-4366-b6f7-ec33753b76b7	3.2500	2.7500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	c1a74934-6cb6-4f33-908b-a5db71df99ce	3.1700	2.8300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	d9fb71d4-3efb-4cd6-b9fc-a2cc4fdeb6d0	3.0900	2.9100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	577a4c98-02e4-47c1-810c-20c519d69762	2.5100	3.4900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	328ff049-4619-47e6-b34b-23e214c776ea	2.7500	3.2500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	5c28e25c-7401-49e5-bf5b-693f5c0b934f	3.3300	3.3300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	577a4c98-02e4-47c1-810c-20c519d69762	2.4500	3.5500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	328ff049-4619-47e6-b34b-23e214c776ea	2.6900	3.3100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	5c28e25c-7401-49e5-bf5b-693f5c0b934f	3.3900	3.3900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	577a4c98-02e4-47c1-810c-20c519d69762	2.3900	3.6100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	328ff049-4619-47e6-b34b-23e214c776ea	2.6300	3.3700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	5c28e25c-7401-49e5-bf5b-693f5c0b934f	3.4500	3.4500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	577a4c98-02e4-47c1-810c-20c519d69762	2.5300	3.4700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	328ff049-4619-47e6-b34b-23e214c776ea	2.7700	3.2300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	5c28e25c-7401-49e5-bf5b-693f5c0b934f	3.3100	3.3100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	577a4c98-02e4-47c1-810c-20c519d69762	2.4800	3.5200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	328ff049-4619-47e6-b34b-23e214c776ea	2.7200	3.2800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	5c28e25c-7401-49e5-bf5b-693f5c0b934f	3.3600	3.3600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	577a4c98-02e4-47c1-810c-20c519d69762	2.4100	3.5900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	328ff049-4619-47e6-b34b-23e214c776ea	2.6500	3.3500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	5c28e25c-7401-49e5-bf5b-693f5c0b934f	3.4300	3.4300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	1cbe6f26-acca-4df4-b641-2e74f0644466	3.0900	2.9100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	486fead0-88a1-4461-b373-356f9ed953cc	3.0100	2.9900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	6689be60-747a-48e4-86c9-8535e50ed1d0	2.7500	2.7500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	2.8300	2.8300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	1cbe6f26-acca-4df4-b641-2e74f0644466	3.0300	2.9700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	486fead0-88a1-4461-b373-356f9ed953cc	2.9500	3.0500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	6689be60-747a-48e4-86c9-8535e50ed1d0	2.8100	2.8100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	2.8900	2.8900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	1cbe6f26-acca-4df4-b641-2e74f0644466	2.9700	3.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	486fead0-88a1-4461-b373-356f9ed953cc	2.8900	3.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	6689be60-747a-48e4-86c9-8535e50ed1d0	2.8700	2.8700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	2.9500	2.9500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	1cbe6f26-acca-4df4-b641-2e74f0644466	3.1100	2.8900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	486fead0-88a1-4461-b373-356f9ed953cc	3.0300	2.9700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	6689be60-747a-48e4-86c9-8535e50ed1d0	2.7300	2.7300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	2.8100	2.8100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	1cbe6f26-acca-4df4-b641-2e74f0644466	3.0600	2.9400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	486fead0-88a1-4461-b373-356f9ed953cc	2.9800	3.0200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	6689be60-747a-48e4-86c9-8535e50ed1d0	2.7800	2.7800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	2.8600	2.8600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	1cbe6f26-acca-4df4-b641-2e74f0644466	2.9900	3.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	486fead0-88a1-4461-b373-356f9ed953cc	2.9100	3.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	6689be60-747a-48e4-86c9-8535e50ed1d0	2.8500	2.8500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	bd614ce2-c4ce-4789-9c6f-b39e49c9ded2	2.9300	2.9300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	2d888823-03d5-4f47-8121-c7240b9871c9	2.6900	3.3100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	038bb428-a2df-41ed-b6dd-f4ed7fe7670d	2.6100	3.3900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	b27a6406-522f-4516-85d3-2f8f5aad247e	2.8500	3.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	3.2300	3.2300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	2d888823-03d5-4f47-8121-c7240b9871c9	2.6300	3.3700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	038bb428-a2df-41ed-b6dd-f4ed7fe7670d	2.5500	3.4500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	b27a6406-522f-4516-85d3-2f8f5aad247e	2.7900	3.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	3.2900	3.2900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	2d888823-03d5-4f47-8121-c7240b9871c9	2.5700	3.4300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	038bb428-a2df-41ed-b6dd-f4ed7fe7670d	2.4900	3.5100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	b27a6406-522f-4516-85d3-2f8f5aad247e	2.7300	3.2700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	3.3500	3.3500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	2d888823-03d5-4f47-8121-c7240b9871c9	2.7100	3.2900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	038bb428-a2df-41ed-b6dd-f4ed7fe7670d	2.6300	3.3700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	b27a6406-522f-4516-85d3-2f8f5aad247e	2.8700	3.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	3.2100	3.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	2d888823-03d5-4f47-8121-c7240b9871c9	2.6600	3.3400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	038bb428-a2df-41ed-b6dd-f4ed7fe7670d	2.5800	3.4200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	b27a6406-522f-4516-85d3-2f8f5aad247e	2.8200	3.1800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	3.2600	3.2600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	2d888823-03d5-4f47-8121-c7240b9871c9	2.5900	3.4100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	038bb428-a2df-41ed-b6dd-f4ed7fe7670d	2.5100	3.4900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	b27a6406-522f-4516-85d3-2f8f5aad247e	2.7500	3.2500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	3bdf54b9-44b2-42c0-a8ed-869cb1d6127d	3.3300	3.3300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	2.5100	2.5100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	739af3f6-1bc8-4612-8953-79d20c0d076d	2.5900	2.5900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	ff3addbd-2dfc-427b-be18-f06366fbefaa	2.3500	2.3500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	2.5700	2.5700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	739af3f6-1bc8-4612-8953-79d20c0d076d	2.6500	2.6500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	ff3addbd-2dfc-427b-be18-f06366fbefaa	2.4100	2.4100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	2.6300	2.6300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	739af3f6-1bc8-4612-8953-79d20c0d076d	2.7100	2.7100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	ff3addbd-2dfc-427b-be18-f06366fbefaa	2.4700	2.4700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	2.4900	2.4900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	739af3f6-1bc8-4612-8953-79d20c0d076d	2.5700	2.5700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	ff3addbd-2dfc-427b-be18-f06366fbefaa	2.3300	2.3300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	2.5400	2.5400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	739af3f6-1bc8-4612-8953-79d20c0d076d	2.6200	2.6200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	ff3addbd-2dfc-427b-be18-f06366fbefaa	2.3800	2.3800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	bcd5b33a-58f6-4f1a-8dab-354c1383f6eb	2.6100	2.6100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	739af3f6-1bc8-4612-8953-79d20c0d076d	2.6900	2.6900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	ff3addbd-2dfc-427b-be18-f06366fbefaa	2.4500	2.4500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	20e1688f-7eaf-4210-b869-895d34d1cef9	2.2300	2.2300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	591af11c-41b9-407e-89fa-8005f96495d1	2.3100	2.3100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	31ccb2df-3712-48f0-955d-1fe7c0757f2f	2.3900	2.3900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	0bfc55ba-040a-499f-a175-0f5ead22d76b	2.1500	2.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	20e1688f-7eaf-4210-b869-895d34d1cef9	2.2900	2.2900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	591af11c-41b9-407e-89fa-8005f96495d1	2.3700	2.3700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	31ccb2df-3712-48f0-955d-1fe7c0757f2f	2.4500	2.4500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	0bfc55ba-040a-499f-a175-0f5ead22d76b	2.2100	2.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	20e1688f-7eaf-4210-b869-895d34d1cef9	2.3500	2.3500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	591af11c-41b9-407e-89fa-8005f96495d1	2.4300	2.4300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	31ccb2df-3712-48f0-955d-1fe7c0757f2f	2.5100	2.5100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	0bfc55ba-040a-499f-a175-0f5ead22d76b	2.2700	2.2700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	20e1688f-7eaf-4210-b869-895d34d1cef9	2.2100	2.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	591af11c-41b9-407e-89fa-8005f96495d1	2.2900	2.2900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	31ccb2df-3712-48f0-955d-1fe7c0757f2f	2.3700	2.3700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	0bfc55ba-040a-499f-a175-0f5ead22d76b	2.1300	2.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	20e1688f-7eaf-4210-b869-895d34d1cef9	2.2600	2.2600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	591af11c-41b9-407e-89fa-8005f96495d1	2.3400	2.3400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	31ccb2df-3712-48f0-955d-1fe7c0757f2f	2.4200	2.4200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	0bfc55ba-040a-499f-a175-0f5ead22d76b	2.1800	2.1800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	20e1688f-7eaf-4210-b869-895d34d1cef9	2.3300	2.3300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	591af11c-41b9-407e-89fa-8005f96495d1	2.4100	2.4100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	31ccb2df-3712-48f0-955d-1fe7c0757f2f	2.4900	2.4900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	0bfc55ba-040a-499f-a175-0f5ead22d76b	2.2500	2.2500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	611ce17d-46c1-4c03-8f2a-5efecf150353	3.6300	3.6300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	f0b259c3-b67e-4ab3-865f-87a374ba968a	3.7100	3.7100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	3.7900	3.7900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	e120a75c-19fa-43aa-b561-2efa9e3e181b	2.4500	3.5500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	611ce17d-46c1-4c03-8f2a-5efecf150353	3.6900	3.6900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	f0b259c3-b67e-4ab3-865f-87a374ba968a	3.7700	3.7700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	3.8500	3.8500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	e120a75c-19fa-43aa-b561-2efa9e3e181b	2.3900	3.6100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	611ce17d-46c1-4c03-8f2a-5efecf150353	3.7500	3.7500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	f0b259c3-b67e-4ab3-865f-87a374ba968a	3.8300	3.8300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	3.9100	3.9100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	e120a75c-19fa-43aa-b561-2efa9e3e181b	2.3300	3.6700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	611ce17d-46c1-4c03-8f2a-5efecf150353	3.6100	3.6100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	f0b259c3-b67e-4ab3-865f-87a374ba968a	3.6900	3.6900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	3.7700	3.7700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	e120a75c-19fa-43aa-b561-2efa9e3e181b	2.4700	3.5300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	611ce17d-46c1-4c03-8f2a-5efecf150353	3.6600	3.6600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	f0b259c3-b67e-4ab3-865f-87a374ba968a	3.7400	3.7400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	3.8200	3.8200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	e120a75c-19fa-43aa-b561-2efa9e3e181b	2.4200	3.5800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	611ce17d-46c1-4c03-8f2a-5efecf150353	3.7300	3.7300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	f0b259c3-b67e-4ab3-865f-87a374ba968a	3.8100	3.8100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	7d6a9563-3c8a-4bae-9bb3-10a50b5cb400	3.8900	3.8900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	e120a75c-19fa-43aa-b561-2efa9e3e181b	2.3500	3.6500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	02c4c493-7a29-4ef3-9532-f48c71227621	3.9300	3.9300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	4.0100	4.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	57cfd248-7532-414c-bbd8-111378c352ce	1.9100	4.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	02c4c493-7a29-4ef3-9532-f48c71227621	3.9900	3.9900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	4.0700	4.0700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	57cfd248-7532-414c-bbd8-111378c352ce	1.8500	4.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	02c4c493-7a29-4ef3-9532-f48c71227621	4.0500	4.0500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	4.1300	4.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	57cfd248-7532-414c-bbd8-111378c352ce	1.7900	4.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	02c4c493-7a29-4ef3-9532-f48c71227621	3.9100	3.9100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	3.9900	3.9900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	57cfd248-7532-414c-bbd8-111378c352ce	1.9300	4.0700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	02c4c493-7a29-4ef3-9532-f48c71227621	3.9600	3.9600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	4.0400	4.0400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	57cfd248-7532-414c-bbd8-111378c352ce	1.8800	4.1200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	02c4c493-7a29-4ef3-9532-f48c71227621	4.0300	4.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	1e7d79ce-0b4f-46ee-8b08-fa5a74d9edc6	4.1100	4.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	57cfd248-7532-414c-bbd8-111378c352ce	1.8100	4.1900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	934886bd-ebb3-4a70-9f62-71aa3e263d20	3.0500	3.0500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	d7521969-e5c0-4e02-954e-9f586bbb3fda	3.1300	3.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	3.2100	3.2100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	e41e4bb4-b564-4184-b1f1-9d3fa7626c03	2.7100	3.2900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	934886bd-ebb3-4a70-9f62-71aa3e263d20	3.1100	3.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	d7521969-e5c0-4e02-954e-9f586bbb3fda	3.1900	3.1900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	3.2700	3.2700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	e41e4bb4-b564-4184-b1f1-9d3fa7626c03	2.6500	3.3500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	934886bd-ebb3-4a70-9f62-71aa3e263d20	3.1700	3.1700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	d7521969-e5c0-4e02-954e-9f586bbb3fda	3.2500	3.2500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	3.3300	3.3300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	e41e4bb4-b564-4184-b1f1-9d3fa7626c03	2.5900	3.4100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	934886bd-ebb3-4a70-9f62-71aa3e263d20	3.0300	3.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	d7521969-e5c0-4e02-954e-9f586bbb3fda	3.1100	3.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	3.1900	3.1900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	e41e4bb4-b564-4184-b1f1-9d3fa7626c03	2.7300	3.2700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	934886bd-ebb3-4a70-9f62-71aa3e263d20	3.0800	3.0800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	d7521969-e5c0-4e02-954e-9f586bbb3fda	3.1600	3.1600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	3.2400	3.2400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	e41e4bb4-b564-4184-b1f1-9d3fa7626c03	2.6800	3.3200	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	934886bd-ebb3-4a70-9f62-71aa3e263d20	3.1500	3.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	d7521969-e5c0-4e02-954e-9f586bbb3fda	3.2300	3.2300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	cc0dddfc-c515-4c0c-a0cc-e3db8fd9197f	3.3100	3.3100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	e41e4bb4-b564-4184-b1f1-9d3fa7626c03	2.6100	3.3900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	83955be9-096b-4dfb-9c01-dc3c07149f8f	2.9500	2.9500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	3fb99c06-b0b0-4b2a-9307-b2fc53815007	3.0300	3.0300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440006	31ee7270-e633-49aa-a789-c8e666b3253d	2.8900	3.1100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	83955be9-096b-4dfb-9c01-dc3c07149f8f	3.0100	3.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	3fb99c06-b0b0-4b2a-9307-b2fc53815007	3.0900	3.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440005	31ee7270-e633-49aa-a789-c8e666b3253d	2.8300	3.1700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	83955be9-096b-4dfb-9c01-dc3c07149f8f	3.0700	3.0700	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	3fb99c06-b0b0-4b2a-9307-b2fc53815007	3.1500	3.1500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440004	31ee7270-e633-49aa-a789-c8e666b3253d	2.7700	3.2300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	83955be9-096b-4dfb-9c01-dc3c07149f8f	2.9300	2.9300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	3fb99c06-b0b0-4b2a-9307-b2fc53815007	3.0100	3.0100	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440003	31ee7270-e633-49aa-a789-c8e666b3253d	2.9100	3.0900	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	83955be9-096b-4dfb-9c01-dc3c07149f8f	2.9800	2.9800	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	3fb99c06-b0b0-4b2a-9307-b2fc53815007	3.0600	3.0600	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440002	31ee7270-e633-49aa-a789-c8e666b3253d	2.8600	3.1400	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	83955be9-096b-4dfb-9c01-dc3c07149f8f	3.0500	3.0500	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	3fb99c06-b0b0-4b2a-9307-b2fc53815007	3.1300	3.1300	2026-03-01 20:44:43.786429+00
44444444-4444-4444-4444-444444440001	31ee7270-e633-49aa-a789-c8e666b3253d	2.7900	3.2100	2026-03-01 20:44:43.786429+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.5500	2.4500	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6100	2.3900	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6100	2.3900	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6100	2.3900	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6100	2.3900	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6100	2.3900	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6100	2.3900	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6700	2.3300	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6700	2.3300	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6700	2.3300	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6700	2.3300	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6700	2.3300	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	4bc594fe-18d8-44b2-ad86-f69d715640d0	3.6700	2.3300	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.7300	2.7300	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6700	2.6700	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6700	2.6700	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6700	2.6700	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6700	2.6700	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6700	2.6700	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6700	2.6700	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6100	2.6100	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6100	2.6100	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6100	2.6100	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6100	2.6100	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6100	2.6100	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	7e138529-c13c-4ea6-b933-45c3e81e87fb	2.6100	2.6100	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	d325d6b7-564e-46df-b949-357fff1fc3d6	3.3400	2.6600	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4000	2.6000	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4000	2.6000	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4000	2.6000	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4000	2.6000	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4000	2.6000	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4000	2.6000	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4600	2.5400	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4600	2.5400	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4600	2.5400	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4600	2.5400	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4600	2.5400	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	d325d6b7-564e-46df-b949-357fff1fc3d6	3.4600	2.5400	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	278211e4-339c-4a8b-a448-efcca33afe55	3.4100	2.5900	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	278211e4-339c-4a8b-a448-efcca33afe55	3.4700	2.5300	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	278211e4-339c-4a8b-a448-efcca33afe55	3.4700	2.5300	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	278211e4-339c-4a8b-a448-efcca33afe55	3.4700	2.5300	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	278211e4-339c-4a8b-a448-efcca33afe55	3.4700	2.5300	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	278211e4-339c-4a8b-a448-efcca33afe55	3.4700	2.5300	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	278211e4-339c-4a8b-a448-efcca33afe55	3.4700	2.5300	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	278211e4-339c-4a8b-a448-efcca33afe55	3.5300	2.4700	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	278211e4-339c-4a8b-a448-efcca33afe55	3.5300	2.4700	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	278211e4-339c-4a8b-a448-efcca33afe55	3.5300	2.4700	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	278211e4-339c-4a8b-a448-efcca33afe55	3.5300	2.4700	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	278211e4-339c-4a8b-a448-efcca33afe55	3.5300	2.4700	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	278211e4-339c-4a8b-a448-efcca33afe55	3.5300	2.4700	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	f214b9e4-74d3-4702-982c-40b5d951be9b	2.5200	2.5200	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4600	2.4600	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4600	2.4600	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4600	2.4600	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4600	2.4600	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4600	2.4600	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4600	2.4600	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4000	2.4000	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4000	2.4000	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4000	2.4000	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4000	2.4000	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4000	2.4000	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	f214b9e4-74d3-4702-982c-40b5d951be9b	2.4000	2.4000	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8000	2.2000	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8600	2.1400	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8600	2.1400	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8600	2.1400	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8600	2.1400	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8600	2.1400	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.8600	2.1400	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.9200	2.0800	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.9200	2.0800	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.9200	2.0800	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.9200	2.0800	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.9200	2.0800	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	d1c80a85-50d5-4b2c-b39f-6e7e62e70836	3.9200	2.0800	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	e4406d81-f759-4171-9783-b6921bb2aac0	3.5200	2.4800	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	e4406d81-f759-4171-9783-b6921bb2aac0	3.5800	2.4200	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	e4406d81-f759-4171-9783-b6921bb2aac0	3.5800	2.4200	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	e4406d81-f759-4171-9783-b6921bb2aac0	3.5800	2.4200	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	e4406d81-f759-4171-9783-b6921bb2aac0	3.5800	2.4200	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	e4406d81-f759-4171-9783-b6921bb2aac0	3.5800	2.4200	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	e4406d81-f759-4171-9783-b6921bb2aac0	3.5800	2.4200	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	e4406d81-f759-4171-9783-b6921bb2aac0	3.6400	2.3600	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	e4406d81-f759-4171-9783-b6921bb2aac0	3.6400	2.3600	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	e4406d81-f759-4171-9783-b6921bb2aac0	3.6400	2.3600	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	e4406d81-f759-4171-9783-b6921bb2aac0	3.6400	2.3600	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	e4406d81-f759-4171-9783-b6921bb2aac0	3.6400	2.3600	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	e4406d81-f759-4171-9783-b6921bb2aac0	3.6400	2.3600	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.5900	2.4100	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.6500	2.3500	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.6500	2.3500	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.6500	2.3500	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.6500	2.3500	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.6500	2.3500	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.6500	2.3500	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.7100	2.2900	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.7100	2.2900	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.7100	2.2900	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.7100	2.2900	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.7100	2.2900	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	4aa86b8d-4686-4b7f-a8d8-ca812129f5a6	3.7100	2.2900	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.6600	2.3400	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7200	2.2800	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7200	2.2800	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7200	2.2800	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7200	2.2800	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7200	2.2800	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7200	2.2800	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7800	2.2200	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7800	2.2200	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7800	2.2200	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7800	2.2200	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7800	2.2200	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	3b2d5de1-e0f3-4cd9-bfb2-b8380eaa9ed1	3.7800	2.2200	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7300	2.2700	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7900	2.2100	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7900	2.2100	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7900	2.2100	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7900	2.2100	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7900	2.2100	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.7900	2.2100	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.8500	2.1500	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.8500	2.1500	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.8500	2.1500	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.8500	2.1500	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.8500	2.1500	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	c9fe1fea-8591-42ec-93cd-aa119bb21678	3.8500	2.1500	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0200	2.9800	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0800	2.9200	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0800	2.9200	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0800	2.9200	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0800	2.9200	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0800	2.9200	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.0800	2.9200	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.1400	2.8600	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.1400	2.8600	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.1400	2.8600	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.1400	2.8600	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.1400	2.8600	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	bb7c6e53-ff9c-4402-bdcd-a9ba35209d81	3.1400	2.8600	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	a57df58a-8cdb-446c-a741-490e1c07307f	2.9100	2.9100	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	a57df58a-8cdb-446c-a741-490e1c07307f	2.8500	2.8500	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	a57df58a-8cdb-446c-a741-490e1c07307f	2.8500	2.8500	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	a57df58a-8cdb-446c-a741-490e1c07307f	2.8500	2.8500	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	a57df58a-8cdb-446c-a741-490e1c07307f	2.8500	2.8500	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	a57df58a-8cdb-446c-a741-490e1c07307f	2.8500	2.8500	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	a57df58a-8cdb-446c-a741-490e1c07307f	2.8500	2.8500	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	a57df58a-8cdb-446c-a741-490e1c07307f	2.7900	2.7900	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	a57df58a-8cdb-446c-a741-490e1c07307f	2.7900	2.7900	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	a57df58a-8cdb-446c-a741-490e1c07307f	2.7900	2.7900	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	a57df58a-8cdb-446c-a741-490e1c07307f	2.7900	2.7900	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	a57df58a-8cdb-446c-a741-490e1c07307f	2.7900	2.7900	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	a57df58a-8cdb-446c-a741-490e1c07307f	2.7900	2.7900	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	b7019767-d2b1-41d3-9348-1882e3118cfb	3.1600	2.8400	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2200	2.7800	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2200	2.7800	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2200	2.7800	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2200	2.7800	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2200	2.7800	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2200	2.7800	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2800	2.7200	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2800	2.7200	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2800	2.7200	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2800	2.7200	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2800	2.7200	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	b7019767-d2b1-41d3-9348-1882e3118cfb	3.2800	2.7200	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7700	2.7700	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7100	2.7100	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7100	2.7100	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7100	2.7100	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7100	2.7100	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7100	2.7100	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.7100	2.7100	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.6500	2.6500	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.6500	2.6500	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.6500	2.6500	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.6500	2.6500	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.6500	2.6500	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	5e4564a0-33c5-4682-8d23-2d15d8515b45	2.6500	2.6500	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	020c801a-be94-44fb-987a-8b71d2a5faa9	3.4900	2.5100	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	020c801a-be94-44fb-987a-8b71d2a5faa9	3.5500	2.4500	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	020c801a-be94-44fb-987a-8b71d2a5faa9	3.5500	2.4500	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	020c801a-be94-44fb-987a-8b71d2a5faa9	3.5500	2.4500	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	020c801a-be94-44fb-987a-8b71d2a5faa9	3.5500	2.4500	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	020c801a-be94-44fb-987a-8b71d2a5faa9	3.5500	2.4500	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	020c801a-be94-44fb-987a-8b71d2a5faa9	3.5500	2.4500	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	020c801a-be94-44fb-987a-8b71d2a5faa9	3.6100	2.3900	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	020c801a-be94-44fb-987a-8b71d2a5faa9	3.6100	2.3900	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	020c801a-be94-44fb-987a-8b71d2a5faa9	3.6100	2.3900	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	020c801a-be94-44fb-987a-8b71d2a5faa9	3.6100	2.3900	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	020c801a-be94-44fb-987a-8b71d2a5faa9	3.6100	2.3900	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	020c801a-be94-44fb-987a-8b71d2a5faa9	3.6100	2.3900	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	49e93d72-84f2-436b-aefa-e63eb1108a61	3.5600	2.4400	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6200	2.3800	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6200	2.3800	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6200	2.3800	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6200	2.3800	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6200	2.3800	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6200	2.3800	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6800	2.3200	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6800	2.3200	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6800	2.3200	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6800	2.3200	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6800	2.3200	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	49e93d72-84f2-436b-aefa-e63eb1108a61	3.6800	2.3200	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6300	2.3700	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6900	2.3100	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6900	2.3100	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6900	2.3100	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6900	2.3100	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6900	2.3100	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.6900	2.3100	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.7500	2.2500	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.7500	2.2500	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.7500	2.2500	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.7500	2.2500	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.7500	2.2500	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	c85a8f16-759e-40b9-9158-2b4d66c497cb	3.7500	2.2500	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7000	2.3000	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7600	2.2400	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7600	2.2400	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7600	2.2400	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7600	2.2400	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7600	2.2400	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.7600	2.2400	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.8200	2.1800	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.8200	2.1800	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.8200	2.1800	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.8200	2.1800	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.8200	2.1800	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	1d7b6cfe-6a9e-4163-8c4d-cedcf5b3f59c	3.8200	2.1800	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.3200	2.3200	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2600	2.2600	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2600	2.2600	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2600	2.2600	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2600	2.2600	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2600	2.2600	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2600	2.2600	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2000	2.2000	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2000	2.2000	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2000	2.2000	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2000	2.2000	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2000	2.2000	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	30ee0b44-cdba-4bbe-a30c-347cd393eed1	2.2000	2.2000	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	32851994-90c8-46f1-ae9f-df99830b56b5	3.7500	2.2500	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	32851994-90c8-46f1-ae9f-df99830b56b5	3.8100	2.1900	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	32851994-90c8-46f1-ae9f-df99830b56b5	3.8100	2.1900	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	32851994-90c8-46f1-ae9f-df99830b56b5	3.8100	2.1900	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	32851994-90c8-46f1-ae9f-df99830b56b5	3.8100	2.1900	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	32851994-90c8-46f1-ae9f-df99830b56b5	3.8100	2.1900	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	32851994-90c8-46f1-ae9f-df99830b56b5	3.8100	2.1900	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	32851994-90c8-46f1-ae9f-df99830b56b5	3.8700	2.1300	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	32851994-90c8-46f1-ae9f-df99830b56b5	3.8700	2.1300	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	32851994-90c8-46f1-ae9f-df99830b56b5	3.8700	2.1300	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	32851994-90c8-46f1-ae9f-df99830b56b5	3.8700	2.1300	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	32851994-90c8-46f1-ae9f-df99830b56b5	3.8700	2.1300	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	32851994-90c8-46f1-ae9f-df99830b56b5	3.8700	2.1300	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.4700	2.5300	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5300	2.4700	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5300	2.4700	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5300	2.4700	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5300	2.4700	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5300	2.4700	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5300	2.4700	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5900	2.4100	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5900	2.4100	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5900	2.4100	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5900	2.4100	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5900	2.4100	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	49751a16-2bda-4b17-b6e7-a0cf4e3f6e2e	3.5900	2.4100	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	61e9581e-9948-4406-a037-b8a3c5a44854	2.5500	2.5500	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	61e9581e-9948-4406-a037-b8a3c5a44854	2.4900	2.4900	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	61e9581e-9948-4406-a037-b8a3c5a44854	2.4900	2.4900	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	61e9581e-9948-4406-a037-b8a3c5a44854	2.4900	2.4900	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	61e9581e-9948-4406-a037-b8a3c5a44854	2.4900	2.4900	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	61e9581e-9948-4406-a037-b8a3c5a44854	2.4900	2.4900	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	61e9581e-9948-4406-a037-b8a3c5a44854	2.4900	2.4900	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	61e9581e-9948-4406-a037-b8a3c5a44854	2.4300	2.4300	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	61e9581e-9948-4406-a037-b8a3c5a44854	2.4300	2.4300	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	61e9581e-9948-4406-a037-b8a3c5a44854	2.4300	2.4300	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	61e9581e-9948-4406-a037-b8a3c5a44854	2.4300	2.4300	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	61e9581e-9948-4406-a037-b8a3c5a44854	2.4300	2.4300	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	61e9581e-9948-4406-a037-b8a3c5a44854	2.4300	2.4300	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.8300	2.8300	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7700	2.7700	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7700	2.7700	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7700	2.7700	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7700	2.7700	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7700	2.7700	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7700	2.7700	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7100	2.7100	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7100	2.7100	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7100	2.7100	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7100	2.7100	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7100	2.7100	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	efa02eb3-6e98-4010-bb1f-5c401bb754d2	2.7100	2.7100	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	08f6c270-1667-4635-9494-b1f31ddbf21e	3.2400	2.7600	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3000	2.7000	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3000	2.7000	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3000	2.7000	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3000	2.7000	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3000	2.7000	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3000	2.7000	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3600	2.6400	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3600	2.6400	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3600	2.6400	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3600	2.6400	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3600	2.6400	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	08f6c270-1667-4635-9494-b1f31ddbf21e	3.3600	2.6400	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3100	2.6900	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3700	2.6300	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3700	2.6300	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3700	2.6300	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3700	2.6300	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3700	2.6300	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.3700	2.6300	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.4300	2.5700	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.4300	2.5700	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.4300	2.5700	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.4300	2.5700	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.4300	2.5700	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	8d355c2a-1fd0-48c0-8195-922fce9e1b7d	3.4300	2.5700	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	b5017f83-9c68-4824-ad35-481f48085589	2.6300	2.6300	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	b5017f83-9c68-4824-ad35-481f48085589	2.5700	2.5700	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	b5017f83-9c68-4824-ad35-481f48085589	2.5700	2.5700	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	b5017f83-9c68-4824-ad35-481f48085589	2.5700	2.5700	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	b5017f83-9c68-4824-ad35-481f48085589	2.5700	2.5700	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	b5017f83-9c68-4824-ad35-481f48085589	2.5700	2.5700	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	b5017f83-9c68-4824-ad35-481f48085589	2.5700	2.5700	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	b5017f83-9c68-4824-ad35-481f48085589	2.5100	2.5100	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	b5017f83-9c68-4824-ad35-481f48085589	2.5100	2.5100	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	b5017f83-9c68-4824-ad35-481f48085589	2.5100	2.5100	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	b5017f83-9c68-4824-ad35-481f48085589	2.5100	2.5100	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	b5017f83-9c68-4824-ad35-481f48085589	2.5100	2.5100	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	b5017f83-9c68-4824-ad35-481f48085589	2.5100	2.5100	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.4400	2.5600	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5000	2.5000	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5000	2.5000	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5000	2.5000	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5000	2.5000	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5000	2.5000	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5000	2.5000	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5600	2.4400	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5600	2.4400	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5600	2.4400	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5600	2.4400	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5600	2.4400	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	32d9ce60-90ea-4728-95bf-4e00e01103dc	3.5600	2.4400	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5100	2.4900	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5700	2.4300	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5700	2.4300	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5700	2.4300	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5700	2.4300	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5700	2.4300	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.5700	2.4300	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.6300	2.3700	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.6300	2.3700	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.6300	2.3700	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.6300	2.3700	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.6300	2.3700	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	b56d32fb-ca6b-4ae5-8f51-3984a25a0a96	3.6300	2.3700	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.5800	2.4200	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.6400	2.3600	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.6400	2.3600	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.6400	2.3600	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.6400	2.3600	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.6400	2.3600	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.6400	2.3600	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.7000	2.3000	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.7000	2.3000	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.7000	2.3000	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.7000	2.3000	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.7000	2.3000	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	1d3281f9-8c64-4eb5-9b4e-646d2dc7d6d7	3.7000	2.3000	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	a667bfa7-869f-4097-b2ea-a579617f2891	2.1900	2.1900	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	a667bfa7-869f-4097-b2ea-a579617f2891	2.1300	2.1300	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	a667bfa7-869f-4097-b2ea-a579617f2891	2.1300	2.1300	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	a667bfa7-869f-4097-b2ea-a579617f2891	2.1300	2.1300	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	a667bfa7-869f-4097-b2ea-a579617f2891	2.1300	2.1300	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	a667bfa7-869f-4097-b2ea-a579617f2891	2.1300	2.1300	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	a667bfa7-869f-4097-b2ea-a579617f2891	2.1300	2.1300	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	a667bfa7-869f-4097-b2ea-a579617f2891	2.0700	2.0700	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	a667bfa7-869f-4097-b2ea-a579617f2891	2.0700	2.0700	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	a667bfa7-869f-4097-b2ea-a579617f2891	2.0700	2.0700	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	a667bfa7-869f-4097-b2ea-a579617f2891	2.0700	2.0700	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	a667bfa7-869f-4097-b2ea-a579617f2891	2.0700	2.0700	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	a667bfa7-869f-4097-b2ea-a579617f2891	2.0700	2.0700	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	6708cca7-6416-45c6-84d4-fad93d09dc67	2.1200	2.1200	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0600	2.0600	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0600	2.0600	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0600	2.0600	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0600	2.0600	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0600	2.0600	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0600	2.0600	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0000	2.0000	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0000	2.0000	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0000	2.0000	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0000	2.0000	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0000	2.0000	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	6708cca7-6416-45c6-84d4-fad93d09dc67	2.0000	2.0000	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	09611139-e4a6-4690-8547-4b9f597948d5	2.0500	2.0500	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	09611139-e4a6-4690-8547-4b9f597948d5	1.9900	1.9900	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	09611139-e4a6-4690-8547-4b9f597948d5	1.9900	1.9900	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	09611139-e4a6-4690-8547-4b9f597948d5	1.9900	1.9900	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	09611139-e4a6-4690-8547-4b9f597948d5	1.9900	1.9900	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	09611139-e4a6-4690-8547-4b9f597948d5	1.9900	1.9900	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	09611139-e4a6-4690-8547-4b9f597948d5	1.9900	1.9900	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	09611139-e4a6-4690-8547-4b9f597948d5	1.9300	1.9300	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	09611139-e4a6-4690-8547-4b9f597948d5	1.9300	1.9300	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	09611139-e4a6-4690-8547-4b9f597948d5	1.9300	1.9300	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	09611139-e4a6-4690-8547-4b9f597948d5	1.9300	1.9300	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	09611139-e4a6-4690-8547-4b9f597948d5	1.9300	1.9300	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	09611139-e4a6-4690-8547-4b9f597948d5	1.9300	1.9300	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.2200	2.2200	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1600	2.1600	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1600	2.1600	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1600	2.1600	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1600	2.1600	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1600	2.1600	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1600	2.1600	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1000	2.1000	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1000	2.1000	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1000	2.1000	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1000	2.1000	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1000	2.1000	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	fb6ded29-0e78-4e05-8db0-eeefa3c76144	2.1000	2.1000	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.1500	2.1500	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0900	2.0900	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0900	2.0900	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0900	2.0900	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0900	2.0900	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0900	2.0900	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0900	2.0900	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0300	2.0300	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0300	2.0300	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0300	2.0300	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0300	2.0300	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0300	2.0300	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	c0b474aa-0311-4eda-8b4b-85d41965e0ca	2.0300	2.0300	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.4300	2.4300	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3700	2.3700	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3700	2.3700	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3700	2.3700	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3700	2.3700	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3700	2.3700	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3700	2.3700	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3100	2.3100	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3100	2.3100	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3100	2.3100	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3100	2.3100	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3100	2.3100	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	8a2a99f3-7f53-4098-a815-c36e4f63db8a	2.3100	2.3100	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3600	2.3600	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3000	2.3000	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3000	2.3000	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3000	2.3000	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3000	2.3000	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3000	2.3000	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.3000	2.3000	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.2400	2.2400	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.2400	2.2400	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.2400	2.2400	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.2400	2.2400	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.2400	2.2400	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	37a36fda-b2c4-41e4-aa06-031a4c2717f8	2.2400	2.2400	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8000	4.2000	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8600	4.1400	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8600	4.1400	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8600	4.1400	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8600	4.1400	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8600	4.1400	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	7a635620-d5af-4403-8ea2-1efbc61900a0	1.8600	4.1400	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	7a635620-d5af-4403-8ea2-1efbc61900a0	1.9200	4.0800	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	7a635620-d5af-4403-8ea2-1efbc61900a0	1.9200	4.0800	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	7a635620-d5af-4403-8ea2-1efbc61900a0	1.9200	4.0800	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	7a635620-d5af-4403-8ea2-1efbc61900a0	1.9200	4.0800	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	7a635620-d5af-4403-8ea2-1efbc61900a0	1.9200	4.0800	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	7a635620-d5af-4403-8ea2-1efbc61900a0	1.9200	4.0800	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4800	4.4800	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4200	4.4200	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4200	4.4200	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4200	4.4200	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4200	4.4200	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4200	4.4200	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.4200	4.4200	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.3600	4.3600	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.3600	4.3600	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.3600	4.3600	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.3600	4.3600	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.3600	4.3600	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	fdfd4eab-e5a5-45a4-9a9a-8972d6c275ce	4.3600	4.3600	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.4100	4.4100	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.3500	4.3500	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.3500	4.3500	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.3500	4.3500	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.3500	4.3500	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.3500	4.3500	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.3500	4.3500	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.2900	4.2900	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.2900	4.2900	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.2900	4.2900	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.2900	4.2900	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.2900	4.2900	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	886c8b7a-42bd-4aef-9d14-de197ae41c10	4.2900	4.2900	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	5770d367-fead-49c9-8d2d-2c272f24067e	4.3400	4.3400	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	5770d367-fead-49c9-8d2d-2c272f24067e	4.2800	4.2800	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	5770d367-fead-49c9-8d2d-2c272f24067e	4.2800	4.2800	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	5770d367-fead-49c9-8d2d-2c272f24067e	4.2800	4.2800	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	5770d367-fead-49c9-8d2d-2c272f24067e	4.2800	4.2800	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	5770d367-fead-49c9-8d2d-2c272f24067e	4.2800	4.2800	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	5770d367-fead-49c9-8d2d-2c272f24067e	4.2800	4.2800	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	5770d367-fead-49c9-8d2d-2c272f24067e	4.2200	4.2200	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	5770d367-fead-49c9-8d2d-2c272f24067e	4.2200	4.2200	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	5770d367-fead-49c9-8d2d-2c272f24067e	4.2200	4.2200	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	5770d367-fead-49c9-8d2d-2c272f24067e	4.2200	4.2200	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	5770d367-fead-49c9-8d2d-2c272f24067e	4.2200	4.2200	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	5770d367-fead-49c9-8d2d-2c272f24067e	4.2200	4.2200	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.1900	2.8100	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.2500	2.7500	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.2500	2.7500	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.2500	2.7500	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.2500	2.7500	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.2500	2.7500	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.2500	2.7500	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.3100	2.6900	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.3100	2.6900	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.3100	2.6900	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.3100	2.6900	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.3100	2.6900	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	0be4464d-c3dd-4048-9fda-5cd4e5b71630	3.3100	2.6900	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.7400	2.7400	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6800	2.6800	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6800	2.6800	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6800	2.6800	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6800	2.6800	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6800	2.6800	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6800	2.6800	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6200	2.6200	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6200	2.6200	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6200	2.6200	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6200	2.6200	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6200	2.6200	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	6febb11f-21d1-41ef-a1bc-ee814c70aea0	2.6200	2.6200	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6700	2.6700	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6100	2.6100	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6100	2.6100	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6100	2.6100	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6100	2.6100	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6100	2.6100	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.6100	2.6100	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.5500	2.5500	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.5500	2.5500	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.5500	2.5500	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.5500	2.5500	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.5500	2.5500	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	fbe80075-8a2c-47d8-a5e0-72e542ff6531	2.5500	2.5500	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5100	3.4900	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5700	3.4300	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5700	3.4300	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5700	3.4300	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5700	3.4300	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5700	3.4300	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.5700	3.4300	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.6300	3.3700	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.6300	3.3700	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.6300	3.3700	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.6300	3.3700	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.6300	3.3700	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	ada98e81-f09f-436c-b7a3-1350b0bb7c59	2.6300	3.3700	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.4200	3.4200	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3600	3.3600	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3600	3.3600	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3600	3.3600	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3600	3.3600	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3600	3.3600	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3600	3.3600	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3000	3.3000	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3000	3.3000	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3000	3.3000	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3000	3.3000	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3000	3.3000	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	8ae04766-4a38-4bd0-94d3-5ba64f40c666	3.3000	3.3000	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	1a829301-36f0-49ea-880f-0bca7de67a1c	3.3500	3.3500	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2900	3.2900	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2900	3.2900	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2900	3.2900	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2900	3.2900	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2900	3.2900	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2900	3.2900	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2300	3.2300	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2300	3.2300	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2300	3.2300	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2300	3.2300	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2300	3.2300	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	1a829301-36f0-49ea-880f-0bca7de67a1c	3.2300	3.2300	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.6300	3.6300	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5700	3.5700	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5700	3.5700	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5700	3.5700	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5700	3.5700	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5700	3.5700	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5700	3.5700	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5100	3.5100	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5100	3.5100	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5100	3.5100	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5100	3.5100	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5100	3.5100	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	77e1f23a-e5bb-43da-a708-8ef4fef087ed	3.5100	3.5100	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2000	3.8000	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2600	3.7400	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2600	3.7400	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2600	3.7400	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2600	3.7400	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2600	3.7400	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.2600	3.7400	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.3200	3.6800	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.3200	3.6800	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.3200	3.6800	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.3200	3.6800	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.3200	3.6800	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	ee0e6ddd-7235-47e1-a3c0-5e6cc085e25e	2.3200	3.6800	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	b01bf0cf-854e-422d-9d30-844098249d86	4.0800	4.0800	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	b01bf0cf-854e-422d-9d30-844098249d86	4.0200	4.0200	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	b01bf0cf-854e-422d-9d30-844098249d86	4.0200	4.0200	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	b01bf0cf-854e-422d-9d30-844098249d86	4.0200	4.0200	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	b01bf0cf-854e-422d-9d30-844098249d86	4.0200	4.0200	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	b01bf0cf-854e-422d-9d30-844098249d86	4.0200	4.0200	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	b01bf0cf-854e-422d-9d30-844098249d86	4.0200	4.0200	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	b01bf0cf-854e-422d-9d30-844098249d86	3.9600	3.9600	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	b01bf0cf-854e-422d-9d30-844098249d86	3.9600	3.9600	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	b01bf0cf-854e-422d-9d30-844098249d86	3.9600	3.9600	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	b01bf0cf-854e-422d-9d30-844098249d86	3.9600	3.9600	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	b01bf0cf-854e-422d-9d30-844098249d86	3.9600	3.9600	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	b01bf0cf-854e-422d-9d30-844098249d86	3.9600	3.9600	2026-03-03 00:55:09.62241+00
36b36900-c8c1-63d4-3e65-13ef87745c2a	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
656786cd-8514-b47c-6f96-065f94109adb	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
c834d036-59a2-d3ab-ea4a-017901d9eaea	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
8c4b850a-b284-2bf8-667f-35861a5d6ab8	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
20ea8c0b-ef5b-9ad0-1ed1-88b22082bd17	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
9973793a-cd4b-00a4-8364-0086ca3e798e	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
f46e8f43-d615-2986-0344-50e7224bfc26	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
6cf4c03e-56f1-fe19-3140-b599811f1ce8	16528ff5-e872-43c8-9df5-96a02e4787c3	4.0100	4.0100	2026-03-03 00:55:09.62241+00
61851fde-9d04-f90c-0996-0ba53df2a0c2	16528ff5-e872-43c8-9df5-96a02e4787c3	3.9500	3.9500	2026-03-03 00:55:09.62241+00
46bf3d7b-d107-6e9e-e257-2c7c49cfeaed	16528ff5-e872-43c8-9df5-96a02e4787c3	3.9500	3.9500	2026-03-03 00:55:09.62241+00
3e7fca1f-5bd2-4e48-ac17-ae6879eec161	16528ff5-e872-43c8-9df5-96a02e4787c3	3.9500	3.9500	2026-03-03 00:55:09.62241+00
a849956e-7811-2cf2-0249-947be4da877b	16528ff5-e872-43c8-9df5-96a02e4787c3	3.9500	3.9500	2026-03-03 00:55:09.62241+00
c783c180-be8e-9597-cd13-3bb1dc5d25a2	16528ff5-e872-43c8-9df5-96a02e4787c3	3.9500	3.9500	2026-03-03 00:55:09.62241+00
c024386b-da24-1275-b30d-1d6bf078032b	16528ff5-e872-43c8-9df5-96a02e4787c3	3.9500	3.9500	2026-03-03 00:55:09.62241+00
d01fcbb0-ae33-fb93-f25e-01fde9d73768	16528ff5-e872-43c8-9df5-96a02e4787c3	3.8900	3.8900	2026-03-03 00:55:09.62241+00
31ae731a-77d0-f452-e7c7-d45107c50613	16528ff5-e872-43c8-9df5-96a02e4787c3	3.8900	3.8900	2026-03-03 00:55:09.62241+00
488b2025-d0e1-a974-11da-b07b42cce96f	16528ff5-e872-43c8-9df5-96a02e4787c3	3.8900	3.8900	2026-03-03 00:55:09.62241+00
91c24e41-5149-5dae-ba22-b9708ae23035	16528ff5-e872-43c8-9df5-96a02e4787c3	3.8900	3.8900	2026-03-03 00:55:09.62241+00
a5869ce3-dd1b-d7bd-76eb-dea78f197b48	16528ff5-e872-43c8-9df5-96a02e4787c3	3.8900	3.8900	2026-03-03 00:55:09.62241+00
681e4e24-4b0d-17b2-325f-ef92cacd1de4	16528ff5-e872-43c8-9df5-96a02e4787c3	3.8900	3.8900	2026-03-03 00:55:09.62241+00
\.


--
-- Data for Name: periodic_programs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."periodic_programs" ("program_id", "title", "description", "target_risk_topic", "trigger_threshold", "schedule_frequency", "schedule_anchor_date", "evaluation_questions", "materials", "metrics") FROM stdin;
dddddddd-dddd-dddd-dddd-dddddddd3001	Programa de prevencao ao assedio	Treinamento e governanca para prevencao ao assedio moral e psicologico.	1	2.20	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3002	Programa de suporte psicologico	Rede estruturada de apoio com atendimento psicologico e acolhimento.	2	2.40	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3003	Programa de gestao de mudancas	Plano de comunicacao e suporte para periodos de mudanca organizacional.	3	2.40	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3004	Programa de clareza de papeis e autonomia	Ajustes de processos para clareza de funcao e autonomia operacional.	4	2.40	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3005	Programa de reconhecimento e cultura	Praticas recorrentes de reconhecimento e feedback da lideranca.	5	2.40	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3006	Programa de gestao do estresse e burnout	Intervencoes para reducao de sobrecarga e prevencao de burnout.	10	2.50	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3007	Programa de comunicacao e relacionamento	Acao integrada para conflitos interpessoais e comunicacao dificil.	11	2.50	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3009	Programa de integracao remoto/isolado	Acoes de pertencimento e suporte para trabalhadores remotos e isolados.	13	2.50	monthly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
dddddddd-dddd-dddd-dddd-dddddddd3008	Programa de apoio a eventos traumaticos	Protocolo de resposta para exposicao a eventos violentos/traumaticos.	8	2.50	biweekly	\N	["The campaign objectives were clear for participants.", "The content and materials were useful in day-to-day work.", "The campaign should continue in the next cycle."]	[]	{"adherenceTarget": 70, "completionTarget": 75, "satisfactionTarget": 4, "participationTarget": 80}
\.


--
-- Data for Name: client_programs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."client_programs" ("client_program_id", "client_id", "program_id", "status", "deployed_at", "schedule_frequency_override", "schedule_anchor_date_override") FROM stdin;
cf8208b6-6c38-cbfc-2694-fa02ececa197	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3001	Recommended	2026-02-20 00:00:00+00	\N	\N
488d7db7-8138-3bee-c718-880d23126591	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3002	Recommended	2026-02-20 00:00:00+00	\N	\N
872c8d03-e357-e085-2ef8-4a901c2cf387	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3002	Recommended	2026-02-22 00:00:00+00	\N	\N
5dd08960-57e0-660e-88aa-eeadbdd99049	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3003	Recommended	2026-02-20 00:00:00+00	\N	\N
7882a216-6a99-ce50-10c6-064ac761a956	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3003	Recommended	2026-02-22 00:00:00+00	\N	\N
d8e8f9a3-9e50-6f52-21e2-bbbdd0c124b2	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3005	Recommended	2026-02-22 00:00:00+00	\N	\N
8845448f-af7d-178b-db23-1e25b27aae06	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3005	Recommended	2026-02-20 00:00:00+00	\N	\N
2e350af1-e6b7-c770-f0d6-e44c13480df6	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3006	Recommended	2026-02-22 00:00:00+00	\N	\N
8e774cdc-5d05-d4de-7e9f-be6251ccd607	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3006	Recommended	2026-02-20 00:00:00+00	\N	\N
b1d99571-42ae-25f5-9c76-ec9fbe40eb4a	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3007	Recommended	2026-02-20 00:00:00+00	\N	\N
de01413a-faab-e530-93e5-021763f532ec	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3007	Recommended	2026-02-22 00:00:00+00	\N	\N
9090f02b-b25c-27d1-3de8-9242d81ee50a	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3009	Recommended	2026-02-22 00:00:00+00	\N	\N
2de655d2-3d0a-b53f-f60b-df6e6259223f	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	dddddddd-dddd-dddd-dddd-dddddddd3006	Active	2026-02-15 00:00:00+00	\N	\N
086e0d4d-ef72-4b57-932b-1454bfe7c66c	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	dddddddd-dddd-dddd-dddd-dddddddd3008	Active	2026-02-20 00:00:00+00	\N	\N
d92fb0be-ad17-d841-1aab-4b5140dd3977	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	dddddddd-dddd-dddd-dddd-dddddddd3001	Completed	2026-02-22 00:00:00+00	\N	\N
d92c9018-4e3c-4e6c-b4a3-e19124fd7c05	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	dddddddd-dddd-dddd-dddd-dddddddd3008	Active	2026-03-03 00:09:00+00	\N	\N
989ce79e-836d-4503-be3a-56c06966e630	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	dddddddd-dddd-dddd-dddd-dddddddd3004	Active	2026-03-03 00:20:00+00	\N	\N
4ac8a984-b089-436b-bd81-357df4565fac	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	dddddddd-dddd-dddd-dddd-dddddddd3005	Active	2026-03-03 00:47:00+00	\N	\N
87b8fb7d-fa83-4a1a-b9ad-da77b245199b	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	dddddddd-dddd-dddd-dddd-dddddddd3008	Active	2026-03-03 22:55:00+00	monthly	2026-03-03
255b5888-c445-4328-94f3-5ca7e7795d4b	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	dddddddd-dddd-dddd-dddd-dddddddd3008	Active	2026-03-02 23:33:00+00	biweekly	\N
eb82aa73-0bf4-4c7d-adbf-91bc31030200	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	dddddddd-dddd-dddd-dddd-dddddddd3007	Active	2026-03-03 23:58:00+00	biweekly	2026-03-03
\.


--
-- Data for Name: calendar_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."calendar_events" ("event_id", "client_id", "source_client_program_id", "event_type", "title", "starts_at", "ends_at", "status", "created_by", "metadata", "created_at", "updated_at") FROM stdin;
0de82b65-64c4-4209-9f96-1948b9b96307	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	4ac8a984-b089-436b-bd81-357df4565fac	continuous_meeting	Reuniao processo continuo: Programa de reconhecimento e cultura	2026-04-02 19:00:00+00	2026-04-02 20:00:00+00	scheduled	client	{"availabilityRequestId": "09702f70-1449-4375-a977-1f6fee89a20a"}	2026-03-03 00:59:11.113509+00	2026-03-03 00:59:32.442+00
6dd0db2e-2216-4d7d-b729-8c7681d30f4d	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	989ce79e-836d-4503-be3a-56c06966e630	continuous_meeting	Reuniao processo continuo: Programa de clareza de papeis e autonomia	2026-04-02 17:00:00+00	2026-04-02 18:00:00+00	scheduled	client	{"availabilityRequestId": "f15c9e2c-6727-444f-8879-b6476e8653de"}	2026-03-03 15:13:35.303224+00	2026-03-03 15:13:58.392+00
737e8206-7562-44fc-bdfe-9cc7fce30cbd	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	989ce79e-836d-4503-be3a-56c06966e630	continuous_meeting	Reuniao processo continuo: Programa de clareza de papeis e autonomia	2026-04-03 13:00:00+00	2026-04-03 14:00:00+00	scheduled	client	{"availabilityRequestId": "f15c9e2c-6727-444f-8879-b6476e8653de"}	2026-03-03 15:13:35.303224+00	2026-03-03 16:38:11.671+00
ec3ed43f-4731-4a50-b4c2-0545ac6647c3	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	87b8fb7d-fa83-4a1a-b9ad-da77b245199b	continuous_meeting	Reuniao processo continuo: Programa de apoio a eventos traumaticos	2026-04-02 13:00:00+00	2026-04-02 14:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de apoio a eventos traumaticos.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 22:55:45.188336+00	2026-03-03 22:56:07.731+00
1416d176-cb89-4a2b-8f21-822b2d812b53	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	87b8fb7d-fa83-4a1a-b9ad-da77b245199b	continuous_meeting	Reuniao processo continuo: Programa de apoio a eventos traumaticos	2026-05-04 13:00:00+00	2026-05-04 14:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de apoio a eventos traumaticos.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 22:55:45.188336+00	2026-03-03 22:56:07.731+00
a93d9fa7-50e7-496d-901f-2e1e1a4e2206	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	87b8fb7d-fa83-4a1a-b9ad-da77b245199b	continuous_meeting	Reuniao processo continuo: Programa de apoio a eventos traumaticos	2026-05-04 17:00:00+00	2026-05-04 18:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de apoio a eventos traumaticos.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 22:55:45.188336+00	2026-03-03 22:56:07.731+00
518d40d6-34c4-4603-bf91-8044bebaf477	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	87b8fb7d-fa83-4a1a-b9ad-da77b245199b	continuous_meeting	Reuniao processo continuo: Programa de apoio a eventos traumaticos	2026-05-04 19:00:00+00	2026-05-04 20:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de apoio a eventos traumaticos.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 22:55:45.188336+00	2026-03-03 22:56:07.731+00
78a9e627-d34d-4d09-8562-bbb1e13aa26b	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	255b5888-c445-4328-94f3-5ca7e7795d4b	continuous_meeting	Reuniao processo continuo: Programa de apoio a eventos traumaticos	2026-04-28 13:00:00+00	2026-04-28 14:00:00+00	scheduled	manager	{"source": "manager_assignment_edit", "content": "Reuniao provisoria do programa Programa de apoio a eventos traumaticos.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 23:54:22.85476+00	2026-03-03 23:54:44.985+00
b67011bf-506e-4dc3-89d5-379e0bb7b5b0	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	255b5888-c445-4328-94f3-5ca7e7795d4b	continuous_meeting	Reuniao processo continuo: Programa de apoio a eventos traumaticos	2026-04-13 13:00:00+00	2026-04-13 14:00:00+00	scheduled	manager	{"source": "manager_assignment_edit", "content": "Reuniao provisoria do programa Programa de apoio a eventos traumaticos.", "proposalKind": "assignment", "eventLifecycle": "committed", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 23:54:22.85476+00	2026-03-03 23:56:35.341+00
d5034f50-9424-4ab5-bd22-5630cd805286	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	eb82aa73-0bf4-4c7d-adbf-91bc31030200	continuous_meeting	Reuniao processo continuo: Programa de comunicacao e relacionamento	2026-03-17 17:00:00+00	2026-03-17 18:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de comunicacao e relacionamento.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 23:58:02.722155+00	2026-03-03 23:58:25.154+00
93885b9d-3208-43a6-80b1-95f1a56c3c16	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	eb82aa73-0bf4-4c7d-adbf-91bc31030200	continuous_meeting	Reuniao processo continuo: Programa de comunicacao e relacionamento	2026-03-31 17:00:00+00	2026-03-31 18:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de comunicacao e relacionamento.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 23:58:02.722155+00	2026-03-03 23:58:25.154+00
e294b332-eb6d-4b36-9e05-bde4200d5518	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	eb82aa73-0bf4-4c7d-adbf-91bc31030200	continuous_meeting	Reuniao processo continuo: Programa de comunicacao e relacionamento	2026-04-28 17:00:00+00	2026-04-28 18:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de comunicacao e relacionamento.", "proposalKind": "assignment", "eventLifecycle": "provisory", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 23:58:02.722155+00	2026-03-03 23:58:25.154+00
1a80dc45-93eb-4deb-8bfc-8c9c922dcbcb	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	eb82aa73-0bf4-4c7d-adbf-91bc31030200	continuous_meeting	Reuniao processo continuo: Programa de comunicacao e relacionamento	2026-04-14 13:00:00+00	2026-04-14 14:00:00+00	scheduled	manager	{"source": "manager_assignment_auto", "content": "Reuniao provisoria gerada pela cadencia do programa Programa de comunicacao e relacionamento.", "proposalKind": "assignment", "eventLifecycle": "committed", "preparationRequired": "Revisar indicadores recentes e alinhar proximos passos."}	2026-03-03 23:58:02.722155+00	2026-03-03 23:58:55.172+00
\.


--
-- Data for Name: client_program_availability_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."client_program_availability_requests" ("request_id", "client_id", "client_program_id", "status", "requested_at", "due_at", "suggested_slots", "selected_slots", "submitted_at", "notes", "created_at", "updated_at") FROM stdin;
87fb48d4-710a-40d5-8b0f-dcd8ab85ec87	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	d92c9018-4e3c-4e6c-b4a3-e19124fd7c05	pending	2026-03-03 00:59:15.301+00	2026-03-13 00:59:15.301+00	[{"endsAt": "2026-04-02T14:00:00.000Z", "startsAt": "2026-04-02T13:00:00.000Z"}, {"endsAt": "2026-04-02T18:00:00.000Z", "startsAt": "2026-04-02T17:00:00.000Z"}, {"endsAt": "2026-04-02T20:00:00.000Z", "startsAt": "2026-04-02T19:00:00.000Z"}, {"endsAt": "2026-05-04T14:00:00.000Z", "startsAt": "2026-05-04T13:00:00.000Z"}, {"endsAt": "2026-05-04T18:00:00.000Z", "startsAt": "2026-05-04T17:00:00.000Z"}, {"endsAt": "2026-05-04T20:00:00.000Z", "startsAt": "2026-05-04T19:00:00.000Z"}, {"endsAt": "2026-06-01T14:00:00.000Z", "startsAt": "2026-06-01T13:00:00.000Z"}, {"endsAt": "2026-06-01T18:00:00.000Z", "startsAt": "2026-06-01T17:00:00.000Z"}]	[]	\N	\N	2026-03-03 00:58:53.997942+00	2026-03-03 00:59:15.301+00
3eafa7be-cbda-43da-941f-4d056c6b1230	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	2de655d2-3d0a-b53f-f60b-df6e6259223f	pending	2026-03-03 00:59:15.301+00	2026-03-13 00:59:15.301+00	[{"endsAt": "2026-03-17T14:00:00.000Z", "startsAt": "2026-03-17T13:00:00.000Z"}, {"endsAt": "2026-03-17T18:00:00.000Z", "startsAt": "2026-03-17T17:00:00.000Z"}, {"endsAt": "2026-03-17T20:00:00.000Z", "startsAt": "2026-03-17T19:00:00.000Z"}, {"endsAt": "2026-04-16T14:00:00.000Z", "startsAt": "2026-04-16T13:00:00.000Z"}, {"endsAt": "2026-04-16T18:00:00.000Z", "startsAt": "2026-04-16T17:00:00.000Z"}, {"endsAt": "2026-04-16T20:00:00.000Z", "startsAt": "2026-04-16T19:00:00.000Z"}, {"endsAt": "2026-05-18T14:00:00.000Z", "startsAt": "2026-05-18T13:00:00.000Z"}, {"endsAt": "2026-05-18T18:00:00.000Z", "startsAt": "2026-05-18T17:00:00.000Z"}]	[]	\N	\N	2026-03-03 00:58:53.997942+00	2026-03-03 00:59:15.301+00
09702f70-1449-4375-a977-1f6fee89a20a	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	4ac8a984-b089-436b-bd81-357df4565fac	submitted	2026-03-03 00:59:15.301+00	2026-03-13 00:59:15.301+00	[{"endsAt": "2026-04-02T14:00:00.000Z", "startsAt": "2026-04-02T13:00:00.000Z"}, {"endsAt": "2026-04-02T18:00:00.000Z", "startsAt": "2026-04-02T17:00:00.000Z"}, {"endsAt": "2026-04-02T20:00:00.000Z", "startsAt": "2026-04-02T19:00:00.000Z"}, {"endsAt": "2026-05-04T14:00:00.000Z", "startsAt": "2026-05-04T13:00:00.000Z"}, {"endsAt": "2026-05-04T18:00:00.000Z", "startsAt": "2026-05-04T17:00:00.000Z"}, {"endsAt": "2026-05-04T20:00:00.000Z", "startsAt": "2026-05-04T19:00:00.000Z"}, {"endsAt": "2026-06-01T14:00:00.000Z", "startsAt": "2026-06-01T13:00:00.000Z"}, {"endsAt": "2026-06-01T18:00:00.000Z", "startsAt": "2026-06-01T17:00:00.000Z"}]	[{"endsAt": "2026-04-02T20:00:00.000Z", "startsAt": "2026-04-02T19:00:00.000Z"}]	2026-03-03 00:59:32.633+00	\N	2026-03-03 00:58:53.997942+00	2026-03-03 00:59:32.633+00
0685f1e1-67a7-416e-a95d-e33714f6acd1	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	255b5888-c445-4328-94f3-5ca7e7795d4b	submitted	2026-03-03 14:16:22.942+00	2026-03-13 14:16:22.942+00	[{"endsAt": "2026-04-01T14:00:00.000Z", "startsAt": "2026-04-01T13:00:00.000Z"}, {"endsAt": "2026-04-01T18:00:00.000Z", "startsAt": "2026-04-01T17:00:00.000Z"}, {"endsAt": "2026-04-01T20:00:00.000Z", "startsAt": "2026-04-01T19:00:00.000Z"}, {"endsAt": "2026-05-01T14:00:00.000Z", "startsAt": "2026-05-01T13:00:00.000Z"}, {"endsAt": "2026-05-01T18:00:00.000Z", "startsAt": "2026-05-01T17:00:00.000Z"}, {"endsAt": "2026-05-01T20:00:00.000Z", "startsAt": "2026-05-01T19:00:00.000Z"}, {"endsAt": "2026-06-01T14:00:00.000Z", "startsAt": "2026-06-01T13:00:00.000Z"}, {"endsAt": "2026-06-01T18:00:00.000Z", "startsAt": "2026-06-01T17:00:00.000Z"}]	[{"endsAt": "2026-04-01T14:00:00.000Z", "startsAt": "2026-04-01T13:00:00.000Z"}, {"endsAt": "2026-04-01T18:00:00.000Z", "startsAt": "2026-04-01T17:00:00.000Z"}]	2026-03-03 14:16:25.379+00	\N	2026-03-03 14:15:59.942034+00	2026-03-03 14:16:25.379+00
f15c9e2c-6727-444f-8879-b6476e8653de	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	989ce79e-836d-4503-be3a-56c06966e630	submitted	2026-03-03 00:59:15.301+00	2026-03-13 00:59:15.301+00	[{"endsAt": "2026-04-02T14:00:00.000Z", "startsAt": "2026-04-02T13:00:00.000Z"}, {"endsAt": "2026-04-02T18:00:00.000Z", "startsAt": "2026-04-02T17:00:00.000Z"}, {"endsAt": "2026-04-02T20:00:00.000Z", "startsAt": "2026-04-02T19:00:00.000Z"}, {"endsAt": "2026-05-04T14:00:00.000Z", "startsAt": "2026-05-04T13:00:00.000Z"}, {"endsAt": "2026-05-04T18:00:00.000Z", "startsAt": "2026-05-04T17:00:00.000Z"}, {"endsAt": "2026-05-04T20:00:00.000Z", "startsAt": "2026-05-04T19:00:00.000Z"}, {"endsAt": "2026-06-01T14:00:00.000Z", "startsAt": "2026-06-01T13:00:00.000Z"}, {"endsAt": "2026-06-01T18:00:00.000Z", "startsAt": "2026-06-01T17:00:00.000Z"}]	[{"endsAt": "2026-04-02T14:00:00.000Z", "startsAt": "2026-04-02T13:00:00.000Z"}, {"endsAt": "2026-04-02T18:00:00.000Z", "startsAt": "2026-04-02T17:00:00.000Z"}]	2026-03-03 15:13:58.652+00	\N	2026-03-03 00:58:53.997942+00	2026-03-03 15:13:58.652+00
e5775b86-cf5d-46bc-bfda-fc646fdea619	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	eb82aa73-0bf4-4c7d-adbf-91bc31030200	submitted	2026-03-03 23:59:55.348+00	2026-03-13 23:59:55.348+00	[{"endsAt": "2026-03-17T18:00:00.000Z", "startsAt": "2026-03-17T17:00:00.000Z"}, {"endsAt": "2026-03-17T20:00:00.000Z", "startsAt": "2026-03-17T19:00:00.000Z"}, {"endsAt": "2026-03-31T18:00:00.000Z", "startsAt": "2026-03-31T17:00:00.000Z"}, {"endsAt": "2026-03-31T20:00:00.000Z", "startsAt": "2026-03-31T19:00:00.000Z"}]	[{"endsAt": "2026-03-17T18:00:00.000Z", "startsAt": "2026-03-17T17:00:00.000Z"}]	2026-03-04 00:03:44.849+00	\N	2026-03-03 23:59:33.603373+00	2026-03-04 00:03:44.849+00
\.


--
-- Data for Name: client_reports; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."client_reports" ("id", "client_id", "survey_id", "report_title", "status", "generated_by", "summary", "created_at") FROM stdin;
99000000-0000-0000-0000-000000000001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	11111111-1111-1111-1111-111111111020	Relatorio DRPS simulado - TechCorp Q2 (20 colaboradores)	ready	manager	{"note": "Relatorio sem PDF para simulacao funcional do dashboard", "source": "mock-seed", "priority_topics": [10, 12, 13], "employees_assessed": 20}	2026-03-08 15:00:00+00
fbe1a737-56ef-4511-8742-1c8cc2e0a89b	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	378e240e-0713-4a21-b150-55a601ea1901	DRPS report DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral - Construtora Aurora - (2026-03-03)	ready	manager	{"survey": {"id": "378e240e-0713-4a21-b150-55a601ea1901", "name": "DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral - Construtora Aurora -", "slug": "construtora-aurora-construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-construtora-aurora-empresa", "status": "live", "kAnonymityMin": 5}, "topics": [{"risk": null, "topicId": 1, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 2, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 3, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 4, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 5, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 6, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 7, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 8, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 9, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 10, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 11, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 12, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 13, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}], "totals": {"topics": 13, "responses": 0, "activeSectors": 1}, "sectors": [{"sector": "dfgsdfgd", "topics": [], "nResponses": 0, "suppressed": false, "riskParameter": 1, "adjustedRiskClass": null, "adjustedRiskIndex": null}], "latestDrps": null, "generatedAt": "2026-03-03T14:16:27.995Z", "riskDistribution": {"low": 0, "high": 0, "medium": 0, "critical": 0}}	2026-03-03 14:16:04.785903+00
49491d33-23a2-45b2-973f-3f54087b6af5	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	DRPS report DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil (2026-03-03)	ready	manager	{"survey": {"id": "2b62207e-fe2f-4a3a-8ad2-c99399e88d57", "name": "DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil", "slug": "techcorp-brasil-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil", "status": "closed", "kAnonymityMin": 5}, "topics": [{"risk": null, "topicId": 1, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 2, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 3, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 4, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 5, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 6, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 7, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 8, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 9, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 10, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 11, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 12, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}, {"risk": null, "topicId": 13, "nResponses": 0, "meanSeverity": null, "severityClass": null, "meanProbability": null, "probabilityClass": null}], "totals": {"topics": 13, "responses": 0, "activeSectors": 1}, "sectors": [{"sector": "sdfasdfasd", "topics": [], "nResponses": 0, "suppressed": false, "riskParameter": 1, "adjustedRiskClass": null, "adjustedRiskIndex": null}], "latestDrps": null, "generatedAt": "2026-03-03T15:18:59.045Z", "riskDistribution": {"low": 0, "high": 0, "medium": 0, "critical": 0}}	2026-03-03 15:18:35.911231+00
\.


--
-- Data for Name: client_sectors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."client_sectors" ("id", "client_id", "key", "name", "remote_workers", "onsite_workers", "hybrid_workers", "risk_parameter", "created_at", "updated_at", "functions", "workers_in_role", "possible_mental_health_harms", "existing_control_measures", "elaboration_date", "shifts", "vulnerable_groups", "main_contact_name", "main_contact_email", "main_contact_phone") FROM stdin;
4fb8dfa0-1562-4357-a4a4-746bb2822351	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	asdfasdfs	asdfasdfs	0	0	0	1.0000	2026-03-03 00:46:10.124877+00	2026-03-03 00:46:31.29+00	\N	0	\N	\N	\N	\N	\N	\N	\N	\N
a1000000-0000-0000-0000-000000000001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	tecnologia	Tecnologia	42	12	8	1.2500	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	62	\N	\N	\N	\N	\N	\N	\N	\N
a1000000-0000-0000-0000-000000000002	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	financeiro	Financeiro	8	30	6	1.1000	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	44	\N	\N	\N	\N	\N	\N	\N	\N
a1000000-0000-0000-0000-000000000003	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	comercial	Comercial	8	24	6	0.9500	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	38	\N	\N	\N	\N	\N	\N	\N	\N
a3000000-0000-0000-0000-000000000001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	comercial	Comercial	10	70	12	1.1200	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	92	\N	\N	\N	\N	\N	\N	\N	\N
a3000000-0000-0000-0000-000000000002	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	atendimento	Atendimento	8	74	14	1.0800	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	96	\N	\N	\N	\N	\N	\N	\N	\N
a3000000-0000-0000-0000-000000000003	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	rh	RH	7	26	9	0.9200	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	42	\N	\N	\N	\N	\N	\N	\N	\N
a5000000-0000-0000-0000-000000000001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005	operacoes	Operacoes	4	42	6	1.0500	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	52	\N	\N	\N	\N	\N	\N	\N	\N
a5000000-0000-0000-0000-000000000002	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005	suporte	Suporte	10	12	6	1.0000	2026-03-03 00:55:09.62241+00	2026-03-03 00:55:09.62241+00	\N	28	\N	\N	\N	\N	\N	\N	\N	\N
f3cb991f-b291-43d9-8cc8-7e3d7451c698	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	dfgsdfgd	dfgsdfgd	0	0	0	1.0000	2026-03-03 01:12:12.256835+00	2026-03-03 01:12:33.379+00	\N	0	\N	\N	\N	\N	\N	\N	\N	\N
a2000000-0000-0000-0000-000000000001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	operacoes	Operacoes	6	210	10	1.3000	2026-03-03 00:55:09.62241+00	2026-03-03 15:35:19.598+00	\N	226	\N	\N	\N	\N	\N	\N	\N	\N
a2000000-0000-0000-0000-000000000002	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	manutencao	Manutencao	2	90	6	1.2000	2026-03-03 00:55:09.62241+00	2026-03-03 15:35:19.598+00	\N	98	\N	\N	\N	\N	\N	\N	\N	\N
a2000000-0000-0000-0000-000000000003	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	seguranca	Seguranca	2	40	4	1.1500	2026-03-03 00:55:09.62241+00	2026-03-03 15:35:19.598+00	\N	46	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: drps_assessments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."drps_assessments" ("id", "survey_id", "sector", "psychologist_name", "psychologist_crp", "company_name", "company_cnpj", "reference_period", "part1_answers", "part1_dimension_scores", "part1_probability_score", "part1_probability_class", "critical_topics", "recommended_programs", "governance_actions", "notes", "created_at") FROM stdin;
55555555-5555-5555-5555-555555550001	11111111-1111-1111-1111-111111111002	Consolidado	Dra Marina Costa	CRP-06/123456	TechCorp Brasil	12.345.678/0001-90	2026-Q1	[{"key": "freq_regularidade", "label": "Regularidade", "score": 4}, {"key": "freq_duracao", "label": "Duracao", "score": 4}, {"key": "freq_impactados", "label": "Impactados", "score": 3}, {"key": "hist_registros", "label": "Registros", "score": 3}, {"key": "hist_gravidade", "label": "Gravidade", "score": 3}, {"key": "hist_causas", "label": "Causas", "score": 3}, {"key": "rec_medidas", "label": "Medidas preventivas", "score": 2}, {"key": "rec_revisao", "label": "Revisao", "score": 2}, {"key": "rec_conhecimento", "label": "Conhecimento", "score": 3}, {"key": "rec_recursos", "label": "Recursos", "score": 2}]	{"history": 3.00, "frequency": 3.67, "resources": 2.25, "resourcesRisk": 3.75}	3.4700	medium	[10, 12, 13]	["Programa de gestao do estresse e prevencao ao burnout", "Programa de prevencao e manejo da ansiedade", "Programa de saude mental e clima organizacional", "Programa de apoio psicologico", "Programa de psicologia positiva", "Programa de formacao de multiplicadores da cultura do cuidado", "Programa de treinamento a equipe de RH para implementacao da NR-01"]	["Reuniao mensal de acompanhamento com liderancas", "Plano de redistribuicao de carga para areas criticas", "Reaplicacao do DRPS em 90 dias"]	Sobrecarga e isolamento em alta no recorte de tecnologia e financeiro.	2026-02-18 14:00:00+00
55555555-5555-5555-5555-555555550002	11111111-1111-1111-1111-111111111003	Consolidado	Dr Rafael Souza	CRP-08/654321	Industria Alfa	98.765.432/0001-10	2026-Q1	[{"key": "freq_regularidade", "label": "Regularidade", "score": 5}, {"key": "freq_duracao", "label": "Duracao", "score": 4}, {"key": "freq_impactados", "label": "Impactados", "score": 4}, {"key": "hist_registros", "label": "Registros", "score": 4}, {"key": "hist_gravidade", "label": "Gravidade", "score": 4}, {"key": "hist_causas", "label": "Causas", "score": 3}, {"key": "rec_medidas", "label": "Medidas preventivas", "score": 2}, {"key": "rec_revisao", "label": "Revisao", "score": 2}, {"key": "rec_conhecimento", "label": "Conhecimento", "score": 2}, {"key": "rec_recursos", "label": "Recursos", "score": 2}]	{"history": 3.67, "frequency": 4.33, "resources": 2.00, "resourcesRisk": 4.00}	4.0000	high	[1, 8, 10, 12]	["Programa de prevencao ao assedio moral e psicologico no trabalho", "Programa de inteligencia emocional para lideres", "Programa de gestao do estresse e prevencao ao burnout", "Programa de prevencao e manejo da ansiedade", "Programa de saude mental e clima organizacional", "Programa de apoio psicologico", "Programa de avaliacao psicologica com acompanhamento individualizado", "Programa de psicologia positiva", "Programa de formacao de multiplicadores da cultura do cuidado", "Programa de treinamento a equipe de RH para implementacao da NR-01"]	["Plano de contingencia para eventos traumaticos", "Treinamento imediato de liderancas operacionais", "Auditoria interna do sistema psicossocial"]	Risco elevado em operacoes e manutencao com destaque para topicos 8, 10 e 12.	2026-02-20 15:00:00+00
55555555-5555-5555-5555-555555550003	11111111-1111-1111-1111-111111111004	Consolidado	Dra Paula Mendes	CRP-04/112233	Varejo Horizonte	45.678.901/0001-22	2026-Q1	[{"key": "freq_regularidade", "label": "Regularidade", "score": 4}, {"key": "freq_duracao", "label": "Duracao", "score": 4}, {"key": "freq_impactados", "label": "Impactados", "score": 3}, {"key": "hist_registros", "label": "Registros", "score": 3}, {"key": "hist_gravidade", "label": "Gravidade", "score": 4}, {"key": "hist_causas", "label": "Causas", "score": 3}, {"key": "rec_medidas", "label": "Medidas preventivas", "score": 3}, {"key": "rec_revisao", "label": "Revisao", "score": 2}, {"key": "rec_conhecimento", "label": "Conhecimento", "score": 3}, {"key": "rec_recursos", "label": "Recursos", "score": 2}]	{"history": 3.33, "frequency": 3.67, "resources": 2.50, "resourcesRisk": 3.50}	3.5000	medium	[1, 2, 10, 11]	["Programa de prevencao ao assedio moral e psicologico no trabalho", "Programa de inteligencia emocional para lideres", "Programa de gestao do estresse e prevencao ao burnout", "Programa de prevencao e manejo da ansiedade", "Programa de saude mental e clima organizacional", "Programa de apoio psicologico", "Programa de psicologia positiva", "Programa de formacao de multiplicadores da cultura do cuidado", "Programa de treinamento a equipe de RH para implementacao da NR-01"]	["Criar comite de clima para unidades de atendimento", "Reforcar protocolo de denuncia e resposta rapida", "Reaplicacao setorial em 120 dias"]	Assedio e conflitos interpessoais persistem em comercial e atendimento.	2026-02-22 16:00:00+00
88000000-0000-0000-0000-000000000001	11111111-1111-1111-1111-111111111020	Consolidado	Dra Marina Costa	CRP-06/123456	TechCorp Brasil	12.345.678/0001-90	2026-Q2	[{"key": "freq_regularidade", "label": "Regularidade", "score": 4}, {"key": "freq_duracao", "label": "Duracao", "score": 4}, {"key": "freq_impactados", "label": "Impactados", "score": 4}, {"key": "hist_registros", "label": "Registros", "score": 3}, {"key": "hist_gravidade", "label": "Gravidade", "score": 3}, {"key": "hist_causas", "label": "Causas", "score": 3}, {"key": "rec_medidas", "label": "Medidas preventivas", "score": 2}, {"key": "rec_revisao", "label": "Revisao", "score": 2}, {"key": "rec_conhecimento", "label": "Conhecimento", "score": 3}, {"key": "rec_recursos", "label": "Recursos", "score": 2}]	{"history": 3.00, "frequency": 4.00, "resources": 2.25, "resourcesRisk": 3.75}	3.5800	medium	[10, 12, 13]	["Programa de gestao do estresse e prevencao ao burnout", "Programa de prevencao e manejo da ansiedade", "Programa de saude mental e clima organizacional", "Programa de apoio psicologico", "Programa de treinamento a equipe de RH para implementacao da NR-01"]	["Reuniao mensal de acompanhamento", "Reaplicacao do DRPS em 90 dias", "Comite multidisciplinar integrado"]	Simulacao com 20 colaboradores: risco alto em sobrecarga (T10) e comunicacao dificil (T12).	2026-03-08 14:30:00+00
\.


--
-- Data for Name: drps_campaigns; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."drps_campaigns" ("campaign_id", "client_id", "campaign_name", "status", "start_date", "end_date", "unique_link_token") FROM stdin;
cccccccc-cccc-cccc-cccc-cccccccc2001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	DRPS 2026 - Q1	Completed	2026-01-10	2026-02-15	tc-2026-q1-xyz
cccccccc-cccc-cccc-cccc-cccccccc2002	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	DRPS 2026 - Q1	Completed	2026-01-12	2026-02-20	ia-2026-q1-xyz
cccccccc-cccc-cccc-cccc-cccccccc2003	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	DRPS 2026 - Q1	Completed	2026-01-15	2026-02-22	vh-2026-q1-xyz
cccccccc-cccc-cccc-cccc-cccccccc2004	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	DRPS 2026 - Q1	Active	2026-02-01	\N	ld-2026-q1-xyz
38795b48-5b66-4576-bfa8-1ea0223e57b1	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil	Active	2026-03-02	\N	techcorp-brasil-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-2-da8d1796
cccccccc-cccc-cccc-cccc-cccccccc2010	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	DRPS 2026 - Q2 Simulacao 20 colaboradores	Completed	2026-03-01	2026-03-02	tc-2026-q2-sim20
2b62207e-fe2f-4a3a-8ad2-c99399e88d57	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil	Active	2026-03-02	\N	techcorp-brasil-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-b0068fbb
898162b4-0df4-41c0-b660-08ae42921b5f	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-e506389d
30b0db18-fb03-416d-9789-aff8abaaff0b	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-2-7b3f1a7a
46f08f19-844a-4ba0-bace-0a6a7dedfcbc	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-3-8f5b1101
8ca47a1b-fe6a-4225-a9d4-d74917baff1f	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-4-7a7feb25
1a195567-49ff-43de-8d82-f39ee3c6f52a	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-construtora-aurora-empresa-geral-bbc37533
db78b658-294e-4cd9-9311-b92195697fb0	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-5-3a73caf9
a18c3be8-6893-4232-8ffa-e61f84049496	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-6-76d2db7d
93559c7b-1836-48c5-bd6d-cd895e547b6e	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-techcorp-brasil-construtora-aurora-empresa-geral-7-b0af11e0
d93d219a-610d-42f5-a5c9-d6d355b236f2	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral	Active	2026-03-02	\N	construtora-aurora-drps-2026-q2-simulacao-20-colaboradores-techcorp-brasil-construtora-aurora-empresa-geral-2-216e06b9
\.


--
-- Data for Name: employee_responses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."employee_responses" ("response_id", "campaign_id", "department", "topic_id", "calculated_risk_score", "submitted_at") FROM stdin;
b36429f9-5c01-5f69-dbc0-7db3b2b92c3d	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	1	2.23	2026-01-16 00:00:00+00
8347f76f-2daa-6e7e-e6ae-359a9dd733bb	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	1	2.16	2026-01-15 00:00:00+00
a627a87a-9c2a-1ab9-cbda-e459344d5645	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	1	2.09	2026-01-14 00:00:00+00
6ad525b1-a3e8-e4aa-1949-ab554e6028ee	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	2	2.13	2026-01-17 00:00:00+00
e5e680be-9011-a651-3ba3-a1bb27879281	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	2	2.06	2026-01-16 00:00:00+00
335c1b35-e646-c513-f97e-b6f60a81e6f4	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	2	1.99	2026-01-15 00:00:00+00
50338da7-e3dd-d5ba-a35b-f5f9efa291e1	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	3	2.43	2026-01-18 00:00:00+00
4ac0dc31-55ca-2017-de6b-084f9d25d30f	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	3	2.36	2026-01-17 00:00:00+00
8bea3b0a-877d-6773-c309-383e803575f1	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	3	2.29	2026-01-16 00:00:00+00
5b740a4d-df1f-c2b4-570c-d07dec750c15	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	4	2.28	2026-01-19 00:00:00+00
a9f1e09b-b755-132c-f7b8-5ef85e08271a	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	4	2.21	2026-01-18 00:00:00+00
e1184fc0-a754-c65f-8e0d-a9db9e2a9b62	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	4	2.14	2026-01-17 00:00:00+00
f881016e-b036-ec5f-9370-d57da2565413	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	5	2.18	2026-01-20 00:00:00+00
16bbcf1b-303d-60f5-59a8-462d5ea15004	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	5	2.11	2026-01-19 00:00:00+00
7296d4ab-ef8a-2cca-b10a-89951d7e618c	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	5	2.04	2026-01-18 00:00:00+00
d427dff1-5b34-95bc-d766-8376d535bf2e	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	6	2.38	2026-01-15 00:00:00+00
9b6f22b5-9eda-d81f-daf0-cdd2c5cab053	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	6	2.31	2026-01-14 00:00:00+00
a54fe7b0-e4ae-cda8-a292-022c45bcba03	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	6	2.24	2026-01-13 00:00:00+00
750992f2-6915-04de-bd6f-28b714563f89	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	7	2.23	2026-01-16 00:00:00+00
609cf84d-4161-a408-6b90-835cb4e4beb7	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	7	2.16	2026-01-15 00:00:00+00
924e68f7-4177-9b75-bd9d-ea070ed5d25f	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	7	2.09	2026-01-14 00:00:00+00
5f682b6e-a600-5dce-2dbc-5ab8dd994a1a	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	8	1.98	2026-01-17 00:00:00+00
d455b63e-1964-c3b4-a916-9e9448482e6a	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	8	1.91	2026-01-16 00:00:00+00
d4f39d6a-37cc-a546-2454-829e5ce16d87	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	8	1.84	2026-01-15 00:00:00+00
017d3360-6cde-9da3-de73-353170df68f3	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	9	2.08	2026-01-18 00:00:00+00
f2ae2d6e-fdb1-558c-0586-f19db1e0a26c	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	9	2.01	2026-01-17 00:00:00+00
e8efb107-cb0c-daed-9035-cdfec145d6ac	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	9	1.94	2026-01-16 00:00:00+00
34dc005f-e8b6-fd2b-7f69-8e42bf7f89cf	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	10	2.88	2026-01-19 00:00:00+00
d0967da1-13a5-44a9-6972-c89e20b1f23c	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	10	2.81	2026-01-18 00:00:00+00
8e013221-c53b-d2e4-e836-e382b98a5649	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	10	2.74	2026-01-17 00:00:00+00
bc1ed7bb-f09b-b9bc-11e1-299956facdb9	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	11	2.38	2026-01-20 00:00:00+00
379d92cd-52a9-3a66-32d5-b3efe2a7dcd7	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	11	2.31	2026-01-19 00:00:00+00
d324452b-678f-d76b-d49d-5495ba12cfc9	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	11	2.24	2026-01-18 00:00:00+00
a710c77d-d2cf-a3c4-2a90-32917b1867d7	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	12	2.63	2026-01-15 00:00:00+00
67d54df0-0762-c83b-2ed7-878437dac196	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	12	2.56	2026-01-14 00:00:00+00
4e067bd7-6ba6-66ad-0cd4-5831573e96a2	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	12	2.49	2026-01-13 00:00:00+00
cc3be2e5-1905-07be-07cd-1383fcc9d731	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	13	2.78	2026-01-16 00:00:00+00
32df1653-de07-8c2d-d8a5-ca803f20e370	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	13	2.71	2026-01-15 00:00:00+00
e85e3c18-6230-810b-6923-8f65e20a90cb	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	13	2.64	2026-01-14 00:00:00+00
cdfe7ccf-81f7-3d5a-3952-c8263139c11b	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	1	2.58	2026-01-18 00:00:00+00
2d2a2488-cce5-43aa-388d-70a018eea502	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	1	2.66	2026-01-17 00:00:00+00
89ad4af2-b82b-4746-6eea-7caf17815721	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	1	2.62	2026-01-16 00:00:00+00
cc1b4450-3c57-020f-ebd7-9579c83409ce	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	2	2.43	2026-01-19 00:00:00+00
34114014-8c15-d647-e6c4-3a93771276ec	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	2	2.51	2026-01-18 00:00:00+00
cc46a997-2272-2348-fa5b-2b4c395b5573	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	2	2.47	2026-01-17 00:00:00+00
0ffffddd-6ecd-ac06-21f1-f96e5108f835	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	3	2.48	2026-01-20 00:00:00+00
d1f3cc56-da56-4ca0-f294-b66bda91df32	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	3	2.56	2026-01-19 00:00:00+00
ddb41a78-bf43-0ae9-ff02-79445ae151d8	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	3	2.52	2026-01-18 00:00:00+00
56d46fe7-5f4b-49ee-e7b4-6d8d27bedd61	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	4	2.28	2026-01-21 00:00:00+00
b032a728-0627-0ad0-5390-47d7cf673075	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	4	2.36	2026-01-20 00:00:00+00
4cce1745-8796-6975-30c0-16540f3fa04b	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	4	2.32	2026-01-19 00:00:00+00
8d7f7a38-9139-bf5d-45eb-746e3fdb0b4d	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	5	2.33	2026-01-22 00:00:00+00
c277fdfc-23f9-03bf-19e8-409067271fd2	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	5	2.41	2026-01-21 00:00:00+00
3a3122bb-9974-e428-7efd-3270595273c1	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	5	2.37	2026-01-20 00:00:00+00
e936d266-f63c-7779-38fa-81c18f14f55f	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	6	2.38	2026-01-17 00:00:00+00
1385a3e4-62d5-95b4-738d-100bca2437db	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	6	2.46	2026-01-16 00:00:00+00
d75a72ac-9a59-ae49-1f19-a9412b866918	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	6	2.42	2026-01-15 00:00:00+00
73bffc20-394c-d0fc-3720-f862ed2e0b1b	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	7	2.48	2026-01-18 00:00:00+00
48dfae56-3998-1d4f-305e-1d19c8172ea4	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	7	2.56	2026-01-17 00:00:00+00
937a0a18-ffa8-7bb5-dea7-dd1c35eefaef	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	7	2.52	2026-01-16 00:00:00+00
5cf29e29-ec17-168b-d345-dc6275d1837d	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	8	2.78	2026-01-19 00:00:00+00
0d4c4aac-f9f7-6db2-f2b1-0de4425138c4	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	8	2.86	2026-01-18 00:00:00+00
2e5b6d38-5d44-44fe-853e-1b5abb18d4f4	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	8	2.82	2026-01-17 00:00:00+00
5fd1d809-20ca-88a9-4528-733b842164ae	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	9	2.08	2026-01-20 00:00:00+00
f63c17b7-896c-347f-f21c-2102664509e4	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	9	2.16	2026-01-19 00:00:00+00
905ce885-7690-ada6-7256-e17dddf68390	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	9	2.12	2026-01-18 00:00:00+00
d83b43fd-2f1f-05af-d9ac-731acc0e57aa	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	10	2.88	2026-01-21 00:00:00+00
1cd58a16-348b-3363-23eb-0472b2004c5b	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	10	2.96	2026-01-20 00:00:00+00
5be5377e-d725-44bb-ee43-5cc4fbfd9314	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	10	2.92	2026-01-19 00:00:00+00
85a6d1bf-20e5-cdfa-b422-e3e23bdde632	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	11	2.43	2026-01-22 00:00:00+00
3dbae4a9-4a7d-de46-1cc1-0592c02054ab	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	11	2.51	2026-01-21 00:00:00+00
b45acb95-0c3f-2f98-ef81-e5f6db4afbe2	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	11	2.47	2026-01-20 00:00:00+00
8d21295a-95b1-0167-0270-1c3debc02916	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	12	2.73	2026-01-17 00:00:00+00
df659bdf-fdc1-dd53-7c9e-661d7b61c9bf	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	12	2.81	2026-01-16 00:00:00+00
4225b418-341a-82e2-8fe2-bfed60d19166	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	12	2.77	2026-01-15 00:00:00+00
b8e273b5-8f9c-a72a-ba6b-faa418ec5238	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	13	2.28	2026-01-18 00:00:00+00
8f26d59c-95b5-7d28-b090-d4a29980b09d	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	13	2.36	2026-01-17 00:00:00+00
7d7e96cb-e22e-6780-2c04-204ba6b2fa24	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	13	2.32	2026-01-16 00:00:00+00
8d959cea-3daa-0e5b-6919-c460a83bd8d0	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	1	2.71	2026-01-21 00:00:00+00
cffaecbd-405a-84d3-1d70-33d432a9174a	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	1	2.83	2026-01-20 00:00:00+00
b6288281-f767-14af-fbc4-d792865b9db4	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	1	2.79	2026-01-19 00:00:00+00
db77ef9f-aa75-0c0e-7164-d7eb2e7c6758	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	2	2.51	2026-01-22 00:00:00+00
f4853d18-f146-df85-a718-c8564f457d09	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	2	2.63	2026-01-21 00:00:00+00
9e1fd4f7-ffbd-9ea3-13ef-312977bb4ec8	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	2	2.59	2026-01-20 00:00:00+00
37cf5b43-c2a1-be19-0885-8d0bc3faf861	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	3	2.36	2026-01-23 00:00:00+00
67aa148c-8678-eaad-b662-371c9e3bc80f	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	3	2.48	2026-01-22 00:00:00+00
f0528b6a-83ff-c517-239c-42f583b0dfcb	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	3	2.44	2026-01-21 00:00:00+00
d62e98f9-a396-9a9a-684b-aea93815d990	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	4	2.26	2026-01-24 00:00:00+00
7637cf59-24cf-b1f9-4b8b-8afc3c99bf94	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	4	2.38	2026-01-23 00:00:00+00
b8aac5a4-7737-304d-25e8-c5172676756c	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	4	2.34	2026-01-22 00:00:00+00
cafb91c4-cee7-11b0-2a44-f6a676e7194a	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	5	2.56	2026-01-25 00:00:00+00
b2296c86-25f2-31d1-1409-b7b635245d4a	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	5	2.68	2026-01-24 00:00:00+00
ca85ddec-63e0-7b39-f8aa-37c4a172397e	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	5	2.64	2026-01-23 00:00:00+00
269a052c-ac84-dabb-9a0d-fb0dec64e89c	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	6	2.31	2026-01-20 00:00:00+00
62bcea5e-8398-c9bc-32b4-e990c828a5e1	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	6	2.43	2026-01-19 00:00:00+00
0ba0b1ad-9f57-8524-e360-2858ccd0108a	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	6	2.39	2026-01-18 00:00:00+00
f78ec86d-9217-b66f-06d8-3f7dd560ad3a	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	7	2.41	2026-01-21 00:00:00+00
5e990ec0-241d-93cc-2359-10f1165b892e	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	7	2.53	2026-01-20 00:00:00+00
b27c1026-0a8e-bda0-520c-48e2335bbf56	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	7	2.49	2026-01-19 00:00:00+00
3beb73c6-28dc-d2fb-60b3-3a037576c3e2	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	8	2.11	2026-01-22 00:00:00+00
1d05be7b-c670-5c92-7d0a-c687b8febc26	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	8	2.23	2026-01-21 00:00:00+00
890a8171-4af6-0bb1-a708-456547ded5f7	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	8	2.19	2026-01-20 00:00:00+00
0456661f-c272-715a-6674-ef2777fd4e7b	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	9	2.01	2026-01-23 00:00:00+00
4feaadf1-80f6-3b71-a8dc-53496e8be292	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	9	2.13	2026-01-22 00:00:00+00
bf284c83-671d-2133-8878-6479d327efcb	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	9	2.09	2026-01-21 00:00:00+00
db3d1d38-7e49-d3bb-ca9b-2e255b9f0b8e	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	10	2.61	2026-01-24 00:00:00+00
e8374171-96cf-11b3-7a8d-eb0d3302c72d	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	10	2.73	2026-01-23 00:00:00+00
b5f1d188-ebfe-dd8b-8199-efb7bb2c8b8d	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	10	2.69	2026-01-22 00:00:00+00
f260061b-d22d-84c8-a256-978b6837fb3a	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	11	2.71	2026-01-25 00:00:00+00
041f882f-a48e-3adf-9a12-a7cb4dda6d23	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	11	2.83	2026-01-24 00:00:00+00
d32c6a4a-e327-d87b-fc13-689a025312e1	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	11	2.79	2026-01-23 00:00:00+00
2f83ee35-841e-e345-6cbf-4cbad4033b52	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	12	2.41	2026-01-20 00:00:00+00
db8e0dd3-c515-ce23-bf08-2ff0a8b5cece	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	12	2.53	2026-01-19 00:00:00+00
02eafc2c-a2ec-194f-932a-2ed4196c301a	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	12	2.49	2026-01-18 00:00:00+00
c09afb33-9bad-e322-1e21-81cb0f5b7b2b	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	13	2.46	2026-01-21 00:00:00+00
1902b490-10c2-4eeb-e00c-1ccf71ee43b8	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	13	2.58	2026-01-20 00:00:00+00
54ce0023-fa99-90dc-c9ae-2aa90d00fdd2	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	13	2.54	2026-01-19 00:00:00+00
7e89997c-f7a6-69ff-c72f-b6592a5ac39c	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	1	2.05	2026-02-06 00:00:00+00
4e78de3c-b4f4-5c7a-eda3-5b9f9acb4a18	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	1	2.02	2026-02-05 00:00:00+00
e6c556b5-b226-f459-23e1-195d02ad798e	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	2	2.10	2026-02-07 00:00:00+00
fc1e4795-7c1d-bbde-c52c-b30535245219	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	2	2.07	2026-02-06 00:00:00+00
cbd778f2-bd8c-18a1-3c9f-c7910b3fad73	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	3	2.20	2026-02-08 00:00:00+00
4e6a8082-50d4-22db-3ed1-9c7d4f3d4f1b	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	3	2.17	2026-02-07 00:00:00+00
274637cb-a8f3-82c6-7bc3-ea6c91e22a30	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	4	2.10	2026-02-09 00:00:00+00
e92ca2f9-bb9e-9441-6b17-53b1987705f9	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	4	2.07	2026-02-08 00:00:00+00
9e3a4daf-cb35-5e3d-ad37-5448915e6d36	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	5	2.05	2026-02-10 00:00:00+00
7a2aa774-b794-e2a0-8234-8f7a9b97175d	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	5	2.02	2026-02-09 00:00:00+00
1974423d-c27b-5917-2270-8aee439041ab	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	6	2.15	2026-02-05 00:00:00+00
f1ad2b8e-049a-39be-c333-86a2062adb55	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	6	2.12	2026-02-04 00:00:00+00
92921e7c-2f27-73a9-ff73-203015002c47	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	7	2.10	2026-02-06 00:00:00+00
ec0b360c-c935-4701-b2b0-345f1170a2d6	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	7	2.07	2026-02-05 00:00:00+00
e8f06ff9-7170-21b5-a092-ee9574a7f71c	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	8	1.95	2026-02-07 00:00:00+00
11638370-3b65-8233-4637-3d5fba8a56e7	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	8	1.92	2026-02-06 00:00:00+00
7abdbdfa-ff87-5d69-5158-2efbcfbca8fb	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	9	1.90	2026-02-08 00:00:00+00
ecd330d5-344a-e723-acc4-3960f5fc174e	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	9	1.87	2026-02-07 00:00:00+00
dd981117-a4bf-695b-82b0-6067e90afcdb	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	10	2.35	2026-02-09 00:00:00+00
a4e11299-4ac2-ce39-c69b-8c168965e4dc	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	10	2.32	2026-02-08 00:00:00+00
9f03dd4c-b3f8-0d4c-a5a2-260fd7eaf4ee	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	11	2.20	2026-02-10 00:00:00+00
7a65ddd7-9d3a-7978-781d-cbd32ce41a73	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	11	2.17	2026-02-09 00:00:00+00
e757c64d-ccb6-0c80-960e-cd6009aa09fa	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	12	2.45	2026-02-05 00:00:00+00
d9d36bfb-342f-6d60-a54d-8a28a8249bd3	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	12	2.42	2026-02-04 00:00:00+00
8773e8e5-2f21-8642-f4d5-a5cd763c7f62	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	13	2.25	2026-02-06 00:00:00+00
f8ce59e8-d7bf-29f6-6a1f-2f00c9170848	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	13	2.22	2026-02-05 00:00:00+00
6f47319e-76d1-0d56-3bf2-63a0603e60fc	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	1	2.31	2026-01-18 00:00:00+00
32f78c19-a8f3-4949-099a-f2e9a728747b	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	1	2.24	2026-01-17 00:00:00+00
dd43594e-30c8-68c6-e760-efcfc9534436	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	1	2.17	2026-01-16 00:00:00+00
d29ffa24-d11a-7bd9-27e8-05976e72ea8e	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	2	2.21	2026-01-19 00:00:00+00
fc98d80e-9357-8e0c-46c0-8b4aae01d724	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	2	2.14	2026-01-18 00:00:00+00
c26551aa-ad6e-9ef7-6ff4-1b5a7bd29c68	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	2	2.07	2026-01-17 00:00:00+00
bd25839c-a0d8-0d1d-1e8a-2957da66fe61	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	3	2.51	2026-01-20 00:00:00+00
ed71cffa-5446-b26a-fa83-5d70b2d161ef	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	3	2.44	2026-01-19 00:00:00+00
caacca4e-b8d9-c6dc-2bca-d1f55e05a52d	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	3	2.37	2026-01-18 00:00:00+00
7901c579-7ffa-249a-4788-962438be969c	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	4	2.36	2026-01-21 00:00:00+00
f5d3acfa-3aef-7cb5-5409-adbbb96f60b8	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	4	2.29	2026-01-20 00:00:00+00
166a1e68-580d-e7cb-f962-c231c1eaf1a6	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	4	2.22	2026-01-19 00:00:00+00
6c9fd61d-f6d0-812c-515b-67d95fd10065	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	5	2.26	2026-01-22 00:00:00+00
897df2c1-e11a-67c2-0c94-93f3cca58312	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	5	2.19	2026-01-21 00:00:00+00
4d17ef6d-6d7a-e00e-f46a-98df7378b0b0	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	5	2.12	2026-01-20 00:00:00+00
cdb7c28b-5fc4-8155-9fe7-55ebdf44a67f	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	6	2.46	2026-01-17 00:00:00+00
f242d3b7-6d42-d7ac-9dad-be86504bd3c2	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	6	2.39	2026-01-16 00:00:00+00
54f90af1-400d-10de-10f9-5508fee537fc	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	6	2.32	2026-01-15 00:00:00+00
2c4e9d53-0a73-c85e-4610-23a06017f259	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	7	2.31	2026-01-18 00:00:00+00
ad78375f-c308-8dce-e47b-3c980ea6fd19	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	7	2.24	2026-01-17 00:00:00+00
c3d7ac40-c8d1-34ea-a206-cbb377b8147d	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	7	2.17	2026-01-16 00:00:00+00
eb19db56-8aab-64bc-03db-8dbbed7c096d	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	8	2.06	2026-01-19 00:00:00+00
91cada62-34bf-c278-c117-cce4048cbdf5	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	8	1.99	2026-01-18 00:00:00+00
ab485aad-3a94-5e8e-69f9-10eb7eb53256	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	8	1.92	2026-01-17 00:00:00+00
ed488d1a-fb66-fde2-d8b9-77173cdb9043	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	9	2.16	2026-01-20 00:00:00+00
7acc4813-1132-5fa2-c750-d546cad03223	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	9	2.09	2026-01-19 00:00:00+00
cce5c82a-68ea-442f-ac96-d4ac7a2a5c5b	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	9	2.02	2026-01-18 00:00:00+00
36ad124f-221f-642e-55b2-f2a97fe7ff93	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	10	2.96	2026-01-21 00:00:00+00
0af828c0-9280-115b-6417-bcad8ed5e268	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	10	2.89	2026-01-20 00:00:00+00
2b3c949b-f0d0-836d-b8b0-e99738f93bda	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	10	2.82	2026-01-19 00:00:00+00
ca870aac-baeb-f218-0dfb-977b0c3a0e37	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	11	2.46	2026-01-22 00:00:00+00
f744ba82-5dd4-488a-8ae2-2b1c34a1d4a1	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	11	2.39	2026-01-21 00:00:00+00
362b6764-5ff4-6a38-570c-548a5e3da8c5	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	11	2.32	2026-01-20 00:00:00+00
3ff6eb4a-75ae-db05-d7dd-aa94adab53d8	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	12	2.71	2026-01-17 00:00:00+00
82a1768f-a520-d5d1-6e70-fbc77d7186bc	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	12	2.64	2026-01-16 00:00:00+00
0e827a3b-7f39-c0e7-e9e0-5e48fdb79656	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	12	2.57	2026-01-15 00:00:00+00
4afeb86a-dfeb-7fd8-47a3-c3cf82b9a8f3	cccccccc-cccc-cccc-cccc-cccccccc2001	Tecnologia	13	2.86	2026-01-18 00:00:00+00
7ba01389-721c-aeee-0da7-5844ed1d1b9b	cccccccc-cccc-cccc-cccc-cccccccc2001	Operacoes	13	2.79	2026-01-17 00:00:00+00
a0065f09-359a-c707-086f-1e61a6cb3d03	cccccccc-cccc-cccc-cccc-cccccccc2001	Financeiro	13	2.72	2026-01-16 00:00:00+00
b2b27d75-89c6-ae83-caaf-39e2e74521df	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	1	2.66	2026-01-20 00:00:00+00
e2088fc6-631f-ab76-0c8d-3b1f1108e8c5	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	1	2.74	2026-01-19 00:00:00+00
0f7ccae7-f949-0630-b6ae-93ae200a969b	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	1	2.70	2026-01-18 00:00:00+00
e1554a82-bf4c-2f17-a59d-4b50267e6b97	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	2	2.51	2026-01-21 00:00:00+00
df4143db-0bbc-6547-e85b-f59e2183b393	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	2	2.59	2026-01-20 00:00:00+00
478ca771-eddd-d178-b395-c8f015b83557	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	2	2.55	2026-01-19 00:00:00+00
44b1005b-216d-e1e8-6bfd-e45536932b37	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	3	2.56	2026-01-22 00:00:00+00
15efc607-3138-6385-4201-dd4c6483bcff	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	3	2.64	2026-01-21 00:00:00+00
77267e5f-f30f-d046-9bd7-5e8902c42857	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	3	2.60	2026-01-20 00:00:00+00
4cee092f-4208-eb0f-978f-4ee404f0f2e2	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	4	2.36	2026-01-23 00:00:00+00
4ae8cb41-0425-9c6e-2e26-7fbb50d4f7f1	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	4	2.44	2026-01-22 00:00:00+00
1109daae-3138-30f4-0be8-02cf1c9bfa37	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	4	2.40	2026-01-21 00:00:00+00
22618751-a70b-a55d-18c5-f47901af98d5	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	5	2.41	2026-01-24 00:00:00+00
9ab01da5-3c65-c250-2f4e-8d2cd8d8e601	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	5	2.49	2026-01-23 00:00:00+00
9b9abef3-47b5-e11c-77b1-8c6ac4f6fd0a	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	5	2.45	2026-01-22 00:00:00+00
02d0e56a-c0a8-abf6-8db6-e528e6f49bb4	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	6	2.46	2026-01-19 00:00:00+00
a06aff37-8f66-49fe-f1b8-56ab21dfb0f8	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	6	2.54	2026-01-18 00:00:00+00
10102089-1a85-0dfa-b059-0159e722ab7f	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	6	2.50	2026-01-17 00:00:00+00
2449c7f0-3635-a654-0c89-b5fc262e5e4f	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	7	2.56	2026-01-20 00:00:00+00
03b2ed05-9e09-698c-940d-31b898ad03cb	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	7	2.64	2026-01-19 00:00:00+00
1477aefc-a73b-8866-aa10-0967b5b80850	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	7	2.60	2026-01-18 00:00:00+00
67ba2314-72da-d83b-6955-fc8c11910265	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	8	2.86	2026-01-21 00:00:00+00
e0f266ef-7647-f8c8-dc63-731c8411e786	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	8	2.94	2026-01-20 00:00:00+00
08218ea3-f137-b0a0-15aa-fc1166d58a2f	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	8	2.90	2026-01-19 00:00:00+00
c8d6606a-37a9-f674-f5d0-9fb28fe03478	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	9	2.16	2026-01-22 00:00:00+00
d3c8c5b0-1eea-ffea-4a0a-a5cbe8625e56	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	9	2.24	2026-01-21 00:00:00+00
7cec7b16-3aa5-3f45-207a-f377c2fd10fb	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	9	2.20	2026-01-20 00:00:00+00
6e1932a8-7e9c-460e-290c-883999f8e0f1	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	10	2.96	2026-01-23 00:00:00+00
5d77e3a0-936f-0575-dddc-5bb6b2521719	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	10	3.00	2026-01-22 00:00:00+00
9c257e3c-c280-3328-35fe-083124dcd058	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	10	3.00	2026-01-21 00:00:00+00
bb4b7634-5c39-4c32-2110-ac40d6aa4494	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	11	2.51	2026-01-24 00:00:00+00
c7a9f45b-5469-d5a4-3544-0f8bf8ca284a	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	11	2.59	2026-01-23 00:00:00+00
30a5ee25-cadc-aac4-b9e6-060897903b51	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	11	2.55	2026-01-22 00:00:00+00
805daa58-ce83-b919-cf3f-7781c7935a86	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	12	2.81	2026-01-19 00:00:00+00
b34922dd-6633-ae83-56e9-8b0ddd535731	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	12	2.89	2026-01-18 00:00:00+00
a916d0fa-2993-ae96-403a-216aed005ba5	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	12	2.85	2026-01-17 00:00:00+00
4d551d24-995f-d708-828d-343ba6c7a517	cccccccc-cccc-cccc-cccc-cccccccc2002	Seguranca	13	2.36	2026-01-20 00:00:00+00
810ba174-ad5c-6d71-623c-a9d940eea1b8	cccccccc-cccc-cccc-cccc-cccccccc2002	Manutencao	13	2.44	2026-01-19 00:00:00+00
1fd57f75-38a2-cfd9-8350-75fb7c0bcaae	cccccccc-cccc-cccc-cccc-cccccccc2002	Operacoes	13	2.40	2026-01-18 00:00:00+00
0320d1a4-b1e9-26f3-691c-394ca3052dc2	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	1	2.79	2026-01-23 00:00:00+00
1f41ef60-74bf-cdc0-01a8-0284560f0bfa	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	1	2.91	2026-01-22 00:00:00+00
9610bce1-46d8-f57d-7349-4278f81b2968	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	1	2.87	2026-01-21 00:00:00+00
098a2a6f-b766-03b7-ea31-e2489e9f0c19	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	2	2.59	2026-01-24 00:00:00+00
994b7983-b81e-bde1-9aa9-3e6fc1c7d6bc	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	2	2.71	2026-01-23 00:00:00+00
51d7f7ad-aee2-f32b-bd45-9bb799a1df7a	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	2	2.67	2026-01-22 00:00:00+00
3f049df7-dde4-82e3-489d-5babc99c3a9d	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	3	2.44	2026-01-25 00:00:00+00
f0df6f4e-45a4-4540-ffa0-f18bda1e88e1	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	3	2.56	2026-01-24 00:00:00+00
4b063a16-c35f-b354-3ed2-fc1d1be290a8	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	3	2.52	2026-01-23 00:00:00+00
422ab650-ddfc-1541-21c3-15fcbc11d0d9	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	4	2.34	2026-01-26 00:00:00+00
baefece9-614c-07e9-27d2-60f08b8b6e4a	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	4	2.46	2026-01-25 00:00:00+00
66f4da7b-68a8-b885-49de-c8a747eb9799	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	4	2.42	2026-01-24 00:00:00+00
819ad332-908b-eb02-a8c7-7dfd9c32feb3	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	5	2.64	2026-01-27 00:00:00+00
2f9d1cd1-b4b8-2260-17fe-e6a1caca77fc	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	5	2.76	2026-01-26 00:00:00+00
b1e9ab44-6875-9403-53ab-ef79f3996707	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	5	2.72	2026-01-25 00:00:00+00
8a84e7df-a5b8-debe-faf6-f38bd1c995ba	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	6	2.39	2026-01-22 00:00:00+00
bb5bdcc9-7ed8-09ca-2ab4-d2f18ed0a69c	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	6	2.51	2026-01-21 00:00:00+00
e4ba7e1d-6aa1-4f74-9bfb-b5337f521935	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	6	2.47	2026-01-20 00:00:00+00
4db14a0b-5c78-aa38-7619-db8af3f03b0d	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	7	2.49	2026-01-23 00:00:00+00
7e757809-9bc6-469f-e9f7-8ea524e1b66d	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	7	2.61	2026-01-22 00:00:00+00
ba64917b-0a5b-5edc-9911-037f44c89a52	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	7	2.57	2026-01-21 00:00:00+00
2fb75157-727f-84d0-d848-ebfbac3240b4	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	8	2.19	2026-01-24 00:00:00+00
cdc5ddad-50ad-fbb4-8aed-c1cc2fc489d9	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	8	2.31	2026-01-23 00:00:00+00
dfbbcb8b-5237-7b0c-3eaf-1ece8c4e492a	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	8	2.27	2026-01-22 00:00:00+00
a80fa6dd-6b1b-e62d-17f9-640587ca7a6b	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	9	2.09	2026-01-25 00:00:00+00
8008ceee-daff-c31a-56af-0c117adda995	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	9	2.21	2026-01-24 00:00:00+00
08a248e4-bc91-b269-0ef2-99c9c8069d36	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	9	2.17	2026-01-23 00:00:00+00
47d9843e-55fb-2138-6634-d4eaf190f321	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	10	2.69	2026-01-26 00:00:00+00
64b5c57d-c6ef-9704-7c57-884ff2768c13	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	10	2.81	2026-01-25 00:00:00+00
d4d68484-5dd0-211e-4880-3f7310af76c9	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	10	2.77	2026-01-24 00:00:00+00
b35b6804-81a9-b3aa-3e62-b9a0c0dd8ab8	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	11	2.79	2026-01-27 00:00:00+00
16dc4d8e-b131-05d4-116d-662d1fd2cdcc	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	11	2.91	2026-01-26 00:00:00+00
b5d7bb36-5c59-02e8-728a-58d69972f530	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	11	2.87	2026-01-25 00:00:00+00
ba8b0058-70cf-2345-03d6-9dd918e9e361	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	12	2.49	2026-01-22 00:00:00+00
c25cad98-5ac1-40c6-1700-903826bf6c05	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	12	2.61	2026-01-21 00:00:00+00
30eb0ac4-cdd5-8b8c-b8bf-f5a5c9151ecc	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	12	2.57	2026-01-20 00:00:00+00
2acdfa5a-b68d-2ef3-a9ba-d4301182759c	cccccccc-cccc-cccc-cccc-cccccccc2003	RH	13	2.54	2026-01-23 00:00:00+00
d40b71ae-3329-d07a-1542-62cc2e4008ee	cccccccc-cccc-cccc-cccc-cccccccc2003	Atendimento	13	2.66	2026-01-22 00:00:00+00
7680b302-394a-62f8-d5c6-a1b51b83257f	cccccccc-cccc-cccc-cccc-cccccccc2003	Comercial	13	2.62	2026-01-21 00:00:00+00
e2b144be-ce62-09a8-cc3e-ce2db3ef306c	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	1	2.13	2026-02-08 00:00:00+00
5b100f61-46d9-348f-88a3-60a6ce32c701	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	1	2.10	2026-02-07 00:00:00+00
f61048be-6b81-1ebb-6587-5c627104138f	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	2	2.18	2026-02-09 00:00:00+00
298e3626-a40f-2bc2-b4b0-5148d809caf8	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	2	2.15	2026-02-08 00:00:00+00
aad1519e-e47f-9cdb-4e12-0068793a10aa	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	3	2.28	2026-02-10 00:00:00+00
cc619a90-08bc-99b5-c10e-adf91d596aa8	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	3	2.25	2026-02-09 00:00:00+00
289b09cd-18f3-2ef0-d810-364d818fa4b2	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	4	2.18	2026-02-11 00:00:00+00
fadeaf0a-9ae7-d164-91b0-d169e85debea	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	4	2.15	2026-02-10 00:00:00+00
9799e6e2-61f6-1bec-26f5-57d72b2868b6	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	5	2.13	2026-02-12 00:00:00+00
0da824b8-bdbd-31f5-4cae-64c3203b6b7a	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	5	2.10	2026-02-11 00:00:00+00
fdab2206-3550-5a4c-f113-ae0959771223	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	6	2.23	2026-02-07 00:00:00+00
e63f0e94-d3d8-4151-c50a-61f82bddb6ea	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	6	2.20	2026-02-06 00:00:00+00
469a48f5-29a9-d348-0fd5-dda60d2e40bc	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	7	2.18	2026-02-08 00:00:00+00
211deedc-35d0-e828-41f4-00ac803758be	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	7	2.15	2026-02-07 00:00:00+00
063d19eb-5b50-aaf3-d22c-611f0e87fdd5	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	8	2.03	2026-02-09 00:00:00+00
e4965a16-21ce-f8cd-1d78-3543c7ea2ea5	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	8	2.00	2026-02-08 00:00:00+00
ecb21bba-d24e-8357-ce21-54de9d729f24	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	9	1.98	2026-02-10 00:00:00+00
10c192c3-0930-f48a-b569-b92a8127fef3	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	9	1.95	2026-02-09 00:00:00+00
a9764000-4e10-464b-64fd-9de624dc3bcd	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	10	2.43	2026-02-11 00:00:00+00
a2e70b54-0566-2226-41aa-5f1c130cdc00	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	10	2.40	2026-02-10 00:00:00+00
f14fff70-babe-8e8a-bb35-946babd53231	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	11	2.28	2026-02-12 00:00:00+00
99d685d7-c154-ba7f-645e-b7ac3687ccdd	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	11	2.25	2026-02-11 00:00:00+00
552ddcd6-8f99-d551-b0f0-bc2047b07733	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	12	2.53	2026-02-07 00:00:00+00
65cf0243-a48d-2435-8669-2714b3246064	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	12	2.50	2026-02-06 00:00:00+00
219fc918-50c1-2077-507d-4750ca5e27f4	cccccccc-cccc-cccc-cccc-cccccccc2004	Logistica	13	2.33	2026-02-08 00:00:00+00
bb285d7b-bc2a-1456-bfd5-8dac6f5fb2d3	cccccccc-cccc-cccc-cccc-cccccccc2004	Operacoes	13	2.30	2026-02-07 00:00:00+00
25454047-6ab3-5692-87c0-e5ff365948ca	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.10	2026-03-01 13:00:00+00
5153bb3f-008b-5d24-8943-aeaa4d973cc2	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.00	2026-03-01 14:00:00+00
ed471a11-7776-52b9-91ad-94dfdfdc075c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.25	2026-03-01 15:00:00+00
54a99d1a-5823-55de-b660-4964c56d3388	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.15	2026-03-01 16:00:00+00
22ce969e-4341-5466-82ac-a597832efaa9	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.05	2026-03-01 17:00:00+00
fa7b2c8a-a14e-577e-880f-3763e48f9af8	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.20	2026-03-01 18:00:00+00
f093e8cd-567b-5a67-9dbc-38df4bf00be9	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.15	2026-03-01 19:00:00+00
dcba6d9a-9eb6-59c2-bf94-f4b1932f8049	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.90	2026-03-01 20:00:00+00
c460187d-a324-550e-92d8-846eae93ef07	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	1.95	2026-03-01 21:00:00+00
998b4361-1d95-5fa8-b25b-eab0605959b8	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.90	2026-03-01 22:00:00+00
a1d1e4de-3681-5e1c-8664-6d3e0c01b566	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.25	2026-03-01 23:00:00+00
4b443342-35b2-5326-b624-f1de97f871a1	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.75	2026-03-02 00:00:00+00
30374a62-0caf-53dc-96ea-13d6c8b24764	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	2.95	2026-03-02 01:00:00+00
bb70120e-e787-5c17-ba23-54e0502ff93f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.13	2026-03-01 16:00:00+00
c17b12dc-5852-5b9e-aa70-a4bfd1599440	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.03	2026-03-01 17:00:00+00
579191f7-4fe6-546f-86d5-f0686f994b2a	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.28	2026-03-01 18:00:00+00
9918b1bb-1660-53fa-ae93-3873ff6267c7	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.18	2026-03-01 19:00:00+00
a0768837-1e02-5d4b-aa14-2c152259789f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.08	2026-03-01 20:00:00+00
84eadbc1-2f7a-544c-928b-f43f39b61874	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.23	2026-03-01 21:00:00+00
449c233a-09ef-512f-8259-116e01620e32	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.18	2026-03-01 22:00:00+00
4da1a729-1fca-53f2-b67c-2876d053c56e	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.93	2026-03-01 23:00:00+00
9453d569-297c-58ed-beb9-0eb5467bbcf8	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	1.98	2026-03-02 00:00:00+00
2f0928b7-11ea-5789-b541-ad90f98bb697	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.93	2026-03-02 01:00:00+00
2c9c5254-bc88-5091-b6ca-8e088ea8ad24	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.28	2026-03-02 02:00:00+00
fb239d42-eff6-5e39-9f98-6b2687fdf72c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.78	2026-03-02 03:00:00+00
81508cbc-3482-54b6-8ee3-5768fa54f2f4	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	2.98	2026-03-02 04:00:00+00
55998a93-b8e8-55ce-a012-dc4926ab2979	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.16	2026-03-01 19:00:00+00
81cfd033-2784-5681-88c5-372326abd03a	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.06	2026-03-01 20:00:00+00
aa40dfa5-e36e-5d92-afed-a137040479e1	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.31	2026-03-01 21:00:00+00
823dc2de-56a2-5220-8425-5dfdb4a37c7e	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.21	2026-03-01 22:00:00+00
7e9ab216-2a47-5151-99f6-eb23756648cd	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.11	2026-03-01 23:00:00+00
5c36946a-89d0-56d0-9b2b-8524e94c45de	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.26	2026-03-02 00:00:00+00
ba80a24b-768f-5530-8071-946f9d81ed7b	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.21	2026-03-02 01:00:00+00
74875a50-89a4-58c6-aeb8-232e7c3bf08f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.96	2026-03-02 02:00:00+00
53518bc7-d400-5421-a3c6-d313b51a5548	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	2.01	2026-03-02 03:00:00+00
0af231f6-d5d1-576f-b857-b78c77dae8aa	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.96	2026-03-02 04:00:00+00
c3f63690-098f-5b11-aac5-b9babe42bb87	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.31	2026-03-02 05:00:00+00
9dbdca5f-fdd6-5b60-90e4-338f12a13e74	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.81	2026-03-02 06:00:00+00
723ac737-67c6-5dc3-b70e-e98f71ec360f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	3.00	2026-03-02 07:00:00+00
35f467f5-d804-5711-aad8-53795021f0b5	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.19	2026-03-01 22:00:00+00
712c169a-e744-58a0-97dd-0c1862bb3637	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.09	2026-03-01 23:00:00+00
af1c92a6-f630-5494-8c1c-7d1a84545285	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.34	2026-03-02 00:00:00+00
67f3fb10-91f3-58f1-bd69-f3e568f59640	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.24	2026-03-02 01:00:00+00
e5e0c01f-ca94-586f-8d7b-d1ba674ebaa2	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.14	2026-03-02 02:00:00+00
8ca0e7aa-032a-56ff-bf33-e7aec1e863bd	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.29	2026-03-02 03:00:00+00
559d36c5-a7f7-5c21-b1a1-0e53c5090edf	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.24	2026-03-02 04:00:00+00
a9af5cd5-84f9-575c-99e5-13e45573f814	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.99	2026-03-02 05:00:00+00
777a43fc-efa6-5011-816a-81c99994a2e5	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	2.04	2026-03-02 06:00:00+00
100c22c7-2b7e-5861-9fb9-135e86ab02e0	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.99	2026-03-02 07:00:00+00
f014d224-0efb-5201-b84c-bf5cb9fab931	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.34	2026-03-02 08:00:00+00
49334868-2b52-50b0-9937-aa38114fc2dc	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.84	2026-03-02 09:00:00+00
1e1ae083-dd88-5c1c-8fe4-2ee7b4703c40	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	3.00	2026-03-02 10:00:00+00
3ef2bca3-44c0-5f73-bdef-ef6bc8664b46	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.07	2026-03-02 01:00:00+00
d6f82332-e8a4-59aa-a7f4-645a0c4659fa	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	1.97	2026-03-02 02:00:00+00
554daef5-5d08-57ed-8700-a3be53988005	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.22	2026-03-02 03:00:00+00
1169aa47-397b-50ac-9e39-b8efc1a87d80	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.12	2026-03-02 04:00:00+00
ab05f482-823d-50bb-a1b9-5653ab2e57fb	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.02	2026-03-02 05:00:00+00
1447a058-de3b-58cb-bc37-3639333ca794	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.17	2026-03-02 06:00:00+00
6ec5323f-a41b-58c8-a8c2-85d3777dbe3b	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.12	2026-03-02 07:00:00+00
4fde4b26-ecee-5f3a-9794-0f19a92aaa12	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.87	2026-03-02 08:00:00+00
da4ffcc2-298a-5809-beae-090ec9aa7f76	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	1.92	2026-03-02 09:00:00+00
0cbb558b-d9b2-5b5a-b6b8-1578f4e1d8af	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.87	2026-03-02 10:00:00+00
36b968ab-a5e8-5b78-9489-46d8c0157f41	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.22	2026-03-02 11:00:00+00
42ed0e99-580d-5694-a5e5-d0d4d0f75c7f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.72	2026-03-02 12:00:00+00
c24f1964-5e13-543c-914a-93dec86af4fd	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	2.92	2026-03-02 13:00:00+00
15f95069-43b1-5e64-8889-450fe7590ec0	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.10	2026-03-02 04:00:00+00
569269fd-fb5f-5b41-9f30-7ba15f0f2de3	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.00	2026-03-02 05:00:00+00
4355a37c-9f4c-54ca-8497-e40842633fde	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.25	2026-03-02 06:00:00+00
025b7cfc-3b28-517e-b844-23f554bb5de9	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.15	2026-03-02 07:00:00+00
2d16c947-e885-5e95-aac0-8d9229efa28f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.05	2026-03-02 08:00:00+00
5dc33e52-e320-57ab-a30d-bcfcd6ac754d	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.20	2026-03-02 09:00:00+00
dce36d20-6c20-5896-92de-fc17eeab8706	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.15	2026-03-02 10:00:00+00
d24cd767-8231-585d-82dd-de02c420cf29	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.90	2026-03-02 11:00:00+00
7070f6c9-9629-540e-98bc-3f0eeb4e1a70	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	1.95	2026-03-02 12:00:00+00
fab371d2-fb8a-5c31-964a-bb7b0672dad1	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.90	2026-03-02 13:00:00+00
03cfa57e-b235-5522-9073-efb1253f6bbb	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.25	2026-03-02 14:00:00+00
6bc2aae7-a363-52b2-8a1a-85d82277fbe1	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.75	2026-03-02 15:00:00+00
d1e763ce-c009-56ed-a2cf-969ae93400c7	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	2.95	2026-03-02 16:00:00+00
ef8cbba4-39c5-5af5-93f9-76b1524da874	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.13	2026-03-02 07:00:00+00
c99e28a0-615c-552d-ab1c-f7c9fa6e1d2b	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.03	2026-03-02 08:00:00+00
7e07c494-2bc7-567a-b339-79e1e590a900	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.28	2026-03-02 09:00:00+00
44ebce86-ee52-504e-8689-6238a59e83be	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.18	2026-03-02 10:00:00+00
dea136ce-778d-5ade-a84a-2eff7bf7e43c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.08	2026-03-02 11:00:00+00
f5addbe4-7cef-5806-ba5a-c5546db96998	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.23	2026-03-02 12:00:00+00
f0584a25-f57d-51ef-97eb-ec31cfdafe80	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.18	2026-03-02 13:00:00+00
54f70980-76f3-5e97-84e6-029599aa8444	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.93	2026-03-02 14:00:00+00
c9f28103-4425-5030-b936-02bbe324402f	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	1.98	2026-03-02 15:00:00+00
20780b09-9c89-52f3-b8c5-12834800cf72	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.93	2026-03-02 16:00:00+00
90aa5432-a971-5c72-ab1b-3fc27ec06f9c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.28	2026-03-02 17:00:00+00
f4354553-d28a-5dcc-b0b7-4b343ff6aa20	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.78	2026-03-02 18:00:00+00
397a0854-6b93-5509-9206-b36398c8f35c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	2.98	2026-03-02 19:00:00+00
b80650ca-8f83-563e-be4d-1959d6e98d0b	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	1	2.16	2026-03-02 10:00:00+00
d42d96f4-c3da-5d0b-bb08-704a26b0242a	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	2	2.06	2026-03-02 11:00:00+00
2a646185-f465-560b-993d-6cebf7eca1c3	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	3	2.31	2026-03-02 12:00:00+00
ea93f876-65d8-52a8-9553-12887ab0c119	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	4	2.21	2026-03-02 13:00:00+00
b061d94a-660b-5b8f-bcb0-68abd199aa23	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	5	2.11	2026-03-02 14:00:00+00
81391ddc-4732-5ac1-b8fe-2ad82bc69297	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	6	2.26	2026-03-02 15:00:00+00
37397f96-1537-5d76-8c11-04843635e7dd	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	7	2.21	2026-03-02 16:00:00+00
6944a9dc-882a-555b-b8db-cb1c577c8f7c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	8	1.96	2026-03-02 17:00:00+00
0c515b9a-25a6-52a0-ab14-7949ef798231	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	9	2.01	2026-03-02 18:00:00+00
17983819-846c-5352-9683-7fb2f4fe48ac	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	10	2.96	2026-03-02 19:00:00+00
8a3d44aa-d266-5e90-acf0-19b3a569d58a	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	11	2.31	2026-03-02 20:00:00+00
bf91129a-4b8b-5389-b4c3-a0b09f1a6e7c	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	12	2.81	2026-03-02 21:00:00+00
2d4fd20d-955f-5dc9-b5de-74c32949e5a9	cccccccc-cccc-cccc-cccc-cccccccc2010	Tecnologia	13	3.00	2026-03-02 22:00:00+00
3773acfb-c498-5ac4-b3a7-f012ca7a1ec0	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	1	2.15	2026-03-02 13:00:00+00
3a28b06f-d00a-52c7-b53c-f462c4418c12	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	2	2.05	2026-03-02 14:00:00+00
9051cf11-f674-5a85-b83b-3c3b23fc8dd6	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	3	2.30	2026-03-02 15:00:00+00
0e313a17-b807-54ab-9d65-de30f984ba29	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	4	2.20	2026-03-02 16:00:00+00
6984da5c-6515-5a7a-b6af-7bc8b09d6287	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	5	2.10	2026-03-02 17:00:00+00
1be51a79-4f69-5dbf-befd-3ae4614d14f7	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	6	2.25	2026-03-02 18:00:00+00
bd780bc8-957d-5028-bede-393aa951728f	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	7	2.20	2026-03-02 19:00:00+00
7fa357c6-7a2e-579c-8e21-c59c3498320c	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	8	1.95	2026-03-02 20:00:00+00
4fe16f9c-587b-5823-b833-e426c6f32197	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	9	2.00	2026-03-02 21:00:00+00
12b3fef6-ef91-58ed-b630-46e24fd9dd94	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	10	2.95	2026-03-02 22:00:00+00
b0ce27ce-642e-5c2e-8369-7af8bbb1a28a	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	11	2.30	2026-03-02 23:00:00+00
fafa160e-3329-5d92-a066-4a59fc6d0870	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	12	2.80	2026-03-03 00:00:00+00
158de848-4e06-58d9-8237-1a643f8ed9dd	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	13	3.00	2026-03-03 01:00:00+00
c8b97511-6ab2-5a5d-b4a7-c97a14fb70c1	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	1	2.03	2026-03-02 16:00:00+00
3c78af4e-dd7b-513e-a1a8-677b0501b036	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	2	1.93	2026-03-02 17:00:00+00
99658964-fdb6-5c0e-b571-6060a47718ee	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	3	2.18	2026-03-02 18:00:00+00
ef81b46f-52a6-51b3-9802-b1e9f3ad9835	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	4	2.08	2026-03-02 19:00:00+00
f099ca1d-b2ee-5e36-bd9f-abbf117c23a9	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	5	1.98	2026-03-02 20:00:00+00
8b16d485-e9cd-506b-9c4b-7e7e628f6113	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	6	2.13	2026-03-02 21:00:00+00
1a3117a8-aa91-5dd2-9b78-305213c22e3b	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	7	2.08	2026-03-02 22:00:00+00
2099cab9-e75a-5310-bad1-87c89bfe3f12	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	8	1.83	2026-03-02 23:00:00+00
834e409e-9a44-5e4e-9efc-0a49a07ee401	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	9	1.88	2026-03-03 00:00:00+00
ed6ff9c2-dfa9-5258-9980-208015cb5c3f	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	10	2.83	2026-03-03 01:00:00+00
f8ffdd3e-fcdb-563a-8601-bf1f115f5338	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	11	2.18	2026-03-03 02:00:00+00
16883c4f-5b95-5143-8dea-6a7a086de971	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	12	2.68	2026-03-03 03:00:00+00
1da809a5-8252-53e9-b5fd-d1a80f782665	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	13	2.88	2026-03-03 04:00:00+00
3ecd2732-d502-59a4-b89e-67cdf950dd6b	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	1	2.06	2026-03-02 19:00:00+00
801ec481-8539-5041-9394-d4fa777b3690	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	2	1.96	2026-03-02 20:00:00+00
77edb59c-06c7-59d8-a931-1170c55d835a	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	3	2.21	2026-03-02 21:00:00+00
f9f03c9f-5441-5944-a322-4521cfe91ec9	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	4	2.11	2026-03-02 22:00:00+00
bed796de-55bb-539d-bbf5-71d80a616570	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	5	2.01	2026-03-02 23:00:00+00
f427567e-ba4c-5fd9-8921-4cef701c9673	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	6	2.16	2026-03-03 00:00:00+00
13f84700-5abc-5277-a36c-51f0f38977ff	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	7	2.11	2026-03-03 01:00:00+00
662af388-9c3b-5bcd-a785-57534652c17d	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	8	1.86	2026-03-03 02:00:00+00
1c21975d-7296-54cc-82ec-10b943812da9	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	9	1.91	2026-03-03 03:00:00+00
6af7e14b-469a-5702-9d6a-ee100ef8346f	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	10	2.86	2026-03-03 04:00:00+00
a54a579d-7de3-51c1-beb5-c44db8fad261	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	11	2.21	2026-03-03 05:00:00+00
b01a931d-e86a-5270-bc5e-a9ed428da2e9	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	12	2.71	2026-03-03 06:00:00+00
e85c058e-f800-53f9-8896-e070dfd93655	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	13	2.91	2026-03-03 07:00:00+00
aa9a91a3-96d5-58dd-862e-7988f39ca715	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	1	2.09	2026-03-02 22:00:00+00
d038341d-ece5-58c7-bcf4-5e4388f74983	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	2	1.99	2026-03-02 23:00:00+00
3936f7bb-6e16-566a-9c85-55e96b84fcc1	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	3	2.24	2026-03-03 00:00:00+00
52d2706e-27db-5e83-96d1-dc595029214b	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	4	2.14	2026-03-03 01:00:00+00
acf9a54a-8282-5a6c-8cc8-0b6b5543168f	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	5	2.04	2026-03-03 02:00:00+00
2723eda7-f7b3-5547-81d8-a51a9175b192	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	6	2.19	2026-03-03 03:00:00+00
98f9c9c5-dfb7-5f7a-aa2f-e832f856ebe2	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	7	2.14	2026-03-03 04:00:00+00
4eef69d2-e678-566a-84a7-47cd275b46fe	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	8	1.89	2026-03-03 05:00:00+00
eb34cdf2-b993-5503-808f-8aa8ad02853a	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	9	1.94	2026-03-03 06:00:00+00
c3f9955d-3ab1-56bd-be47-11d5a2213453	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	10	2.89	2026-03-03 07:00:00+00
8a782ef0-4f22-59f4-8249-2d6d1425270e	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	11	2.24	2026-03-03 08:00:00+00
42062251-4224-5208-b553-f149c2331fc1	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	12	2.74	2026-03-03 09:00:00+00
4a74ce05-c1d7-527b-a736-de9894faf2d0	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	13	2.94	2026-03-03 10:00:00+00
54ac551d-747a-5036-9132-45e6b6703de3	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	1	2.12	2026-03-03 01:00:00+00
5cc35b20-5bf0-5d10-9a5f-2230795c3ff5	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	2	2.02	2026-03-03 02:00:00+00
d884ba16-5848-5290-815c-54c77d7c35c9	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	3	2.27	2026-03-03 03:00:00+00
78e8168f-f7e5-52bf-8bcb-a388c9c154aa	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	4	2.17	2026-03-03 04:00:00+00
6833e684-f168-51c1-b79f-d95b4055a969	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	5	2.07	2026-03-03 05:00:00+00
ce28973e-0b29-5a56-bf37-abc0de8865f1	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	6	2.22	2026-03-03 06:00:00+00
f538c0dd-6b73-5b5b-9d54-04cd02210984	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	7	2.17	2026-03-03 07:00:00+00
1d61a438-2e9f-5a7d-bbd8-6c3ff2c1d298	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	8	1.92	2026-03-03 08:00:00+00
7b599676-29cb-521c-8ed8-3c62bfb0113f	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	9	1.97	2026-03-03 09:00:00+00
bcc60de1-cfeb-5f20-8b21-85e346c77b01	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	10	2.92	2026-03-03 10:00:00+00
e51378bb-10bc-5e58-a5e3-88a7b4995d3f	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	11	2.27	2026-03-03 11:00:00+00
6ca57101-74b6-5f64-b575-d54a536ccc52	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	12	2.77	2026-03-03 12:00:00+00
a2ab5c34-1cce-54f9-ab0e-05bd27c615e3	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	13	2.97	2026-03-03 13:00:00+00
6a0cbc8e-d107-5c90-ad7d-3155cabc20cf	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	1	2.15	2026-03-03 04:00:00+00
70cd0e05-0c9c-5c19-b54c-25c7cfb51bf1	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	2	2.05	2026-03-03 05:00:00+00
8f8f208b-96cd-5d14-b53f-969b9076471e	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	3	2.30	2026-03-03 06:00:00+00
c3d39ee8-7a57-57fa-b172-3239a3c99683	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	4	2.20	2026-03-03 07:00:00+00
81a9ea68-872a-59f9-ac19-8a87cd393373	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	5	2.10	2026-03-03 08:00:00+00
ea190971-43a9-5b64-9286-cb3f086da3b4	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	6	2.25	2026-03-03 09:00:00+00
b97ddfc0-4d97-5995-8e0a-d1ed5e573830	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	7	2.20	2026-03-03 10:00:00+00
4e93a568-686c-540c-9275-81f3fe53c016	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	8	1.95	2026-03-03 11:00:00+00
a4c39c91-9728-5ef4-a1e8-6fe1bd1edb5a	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	9	2.00	2026-03-03 12:00:00+00
ce59f080-e8e8-5b49-8e2e-70f0bdc34912	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	10	2.95	2026-03-03 13:00:00+00
665e67ec-c7ab-521d-83c9-9a7e22a165d3	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	11	2.30	2026-03-03 14:00:00+00
3bf06075-4cce-5109-9ad1-9cafb6bce91a	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	12	2.80	2026-03-03 15:00:00+00
d933866e-4958-5812-98bd-439f65f6c772	cccccccc-cccc-cccc-cccc-cccccccc2010	Financeiro	13	3.00	2026-03-03 16:00:00+00
c53bf5de-57a2-5a42-9ced-841e02978fc7	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	1	2.01	2026-03-03 07:00:00+00
ad4f3747-743d-5a90-a335-684dcb9c6174	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	2	1.91	2026-03-03 08:00:00+00
8d352bb6-279f-583a-b2ee-245d926b79b1	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	3	2.16	2026-03-03 09:00:00+00
6fdd44c9-a310-59ff-bb18-ab85ed8b8234	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	4	2.06	2026-03-03 10:00:00+00
2074f5be-80b2-571d-9749-f56d8b864521	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	5	1.96	2026-03-03 11:00:00+00
0649655c-6689-575e-b979-6c1ac92397aa	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	6	2.11	2026-03-03 12:00:00+00
a4542d61-4db5-52e1-99fb-0251978705f0	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	7	2.06	2026-03-03 13:00:00+00
52f07d2a-22b8-585a-98fe-ef44953bef69	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	8	1.81	2026-03-03 14:00:00+00
4a61a0d3-56cc-5512-baa8-e605bcc20333	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	9	1.86	2026-03-03 15:00:00+00
2c212cbf-9676-5783-9b5e-7c918b4c74d1	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	10	2.81	2026-03-03 16:00:00+00
8a1dff99-de6b-5ff9-9922-bfc6042d734e	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	11	2.16	2026-03-03 17:00:00+00
a7cff514-0164-524d-9fbf-fc5e3945b0cd	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	12	2.66	2026-03-03 18:00:00+00
fd221a5e-4448-5056-816d-f39b9a659a84	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	13	2.86	2026-03-03 19:00:00+00
dcf231f2-ca40-5e68-b2e7-543bbf6ad9a3	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	1	2.04	2026-03-03 10:00:00+00
702fbce7-a9f0-5b14-a0b0-0271480e7966	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	2	1.94	2026-03-03 11:00:00+00
de9ad021-8252-5a2c-b778-1b7b0c7637e4	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	3	2.19	2026-03-03 12:00:00+00
001a22ad-0b1d-5455-a566-42e92cfc7ac2	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	4	2.09	2026-03-03 13:00:00+00
a9b9b51d-df7b-543b-8f08-efd77750f8e2	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	5	1.99	2026-03-03 14:00:00+00
35a636cf-3298-5963-9bdf-db6aee969dca	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	6	2.14	2026-03-03 15:00:00+00
24f3a6ff-2772-5866-b3ae-155720ccaad4	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	7	2.09	2026-03-03 16:00:00+00
92938ede-6a4e-5a80-80ac-3025499218e8	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	8	1.84	2026-03-03 17:00:00+00
d437378b-c4e4-5faa-95f2-6c58c4ff18ea	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	9	1.89	2026-03-03 18:00:00+00
e185d242-9657-5710-95de-f2ccd3cd033a	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	10	2.84	2026-03-03 19:00:00+00
fe91dc46-d70f-5380-a714-8b9eb723e638	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	11	2.19	2026-03-03 20:00:00+00
3ae6588c-35cf-59be-86ef-52783e1a195f	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	12	2.69	2026-03-03 21:00:00+00
090e7e63-e531-5be6-bc10-f304f4843ead	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	13	2.89	2026-03-03 22:00:00+00
fce29a08-7d7a-589e-a676-5a12c8ca0e1c	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	1	2.07	2026-03-03 13:00:00+00
63f96c79-a350-5823-a7c2-e0c40b14275e	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	2	1.97	2026-03-03 14:00:00+00
c02990ca-2e30-556a-a5f6-7ebfb5c90380	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	3	2.22	2026-03-03 15:00:00+00
5987ada9-27f8-596f-be9e-843457fcdad6	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	4	2.12	2026-03-03 16:00:00+00
aa6bb53f-498e-5134-a569-1688ccf0c8d3	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	5	2.02	2026-03-03 17:00:00+00
08158fa6-a99e-57af-904f-45a7f1219372	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	6	2.17	2026-03-03 18:00:00+00
51bc7b8b-a6e0-544a-b207-c943149a584b	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	7	2.12	2026-03-03 19:00:00+00
4b9eb895-9f42-5bcc-b1a1-28192db99ae9	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	8	1.87	2026-03-03 20:00:00+00
8a8e6a90-b0cf-533e-8320-38488901f1a3	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	9	1.92	2026-03-03 21:00:00+00
360835b3-2e0b-50ef-b6b3-0e308d5b8b76	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	10	2.87	2026-03-03 22:00:00+00
1844f4b2-4f71-5b14-b99d-a60ef2e9c5aa	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	11	2.22	2026-03-03 23:00:00+00
cdcf4345-6de4-55e8-ad1c-a8b88d2848f3	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	12	2.72	2026-03-04 00:00:00+00
f5e12873-8751-59b0-bb5d-fd5bc4719062	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	13	2.92	2026-03-04 01:00:00+00
0d3caa08-6cbf-5c20-896b-83ab3d650fa6	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	1	2.10	2026-03-03 16:00:00+00
81baf1f9-a073-5500-b9d8-c2c831544f7e	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	2	2.00	2026-03-03 17:00:00+00
46fd5829-e70a-55cf-b8f1-32e702785bd3	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	3	2.25	2026-03-03 18:00:00+00
2c7a7fa9-a0bc-5961-a461-9dfbcf85793e	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	4	2.15	2026-03-03 19:00:00+00
6429c723-bf51-595f-a12a-f7bf6165ed73	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	5	2.05	2026-03-03 20:00:00+00
b3de20bf-b4f3-51b7-8762-11e9933ae259	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	6	2.20	2026-03-03 21:00:00+00
8accd1f5-b115-57b7-a8ce-06841b42d909	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	7	2.15	2026-03-03 22:00:00+00
b8162232-609d-5806-9edf-c9aa35f78c71	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	8	1.90	2026-03-03 23:00:00+00
85a92152-e9df-59db-9686-1f8b171bde54	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	9	1.95	2026-03-04 00:00:00+00
80c9c95d-b48e-516b-aafc-aea1aba0d921	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	10	2.90	2026-03-04 01:00:00+00
1d758e93-7b16-569c-8941-e8746a84ce68	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	11	2.25	2026-03-04 02:00:00+00
aa991959-1276-5e5e-b0df-cf181f796103	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	12	2.75	2026-03-04 03:00:00+00
aa161121-f5c6-5d37-b4ca-679f8a2813fd	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	13	2.95	2026-03-04 04:00:00+00
0bbbc352-1e8d-5a5a-8488-574546175a74	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	1	2.13	2026-03-03 19:00:00+00
dd8c0ece-3822-5147-8b2b-63546e0902dd	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	2	2.03	2026-03-03 20:00:00+00
2e706aa7-864b-5efc-80ae-a5d63fe2abab	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	3	2.28	2026-03-03 21:00:00+00
cc9a0dac-5f1b-5d1c-a6db-3a2d892d04b5	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	4	2.18	2026-03-03 22:00:00+00
6804de3f-f897-5f63-a8e6-9e5ca34fcaeb	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	5	2.08	2026-03-03 23:00:00+00
3b19f295-8c3f-54bc-a64e-8fec04bfaafb	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	6	2.23	2026-03-04 00:00:00+00
2f53a0fb-ead2-529e-8fb1-1b0c1c5c8929	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	7	2.18	2026-03-04 01:00:00+00
169f6119-d7ad-5c78-8191-9f331f31a9db	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	8	1.93	2026-03-04 02:00:00+00
e778687f-a259-55b2-8ede-2b37484d51ab	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	9	1.98	2026-03-04 03:00:00+00
9a806da2-1cbc-55b2-8832-971721bce8fd	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	10	2.93	2026-03-04 04:00:00+00
9ac0aaa2-76c1-5290-adfc-4fa30549227f	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	11	2.28	2026-03-04 05:00:00+00
6a889c31-e9b6-5fa3-8e8a-0d2bfd5c4c9b	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	12	2.78	2026-03-04 06:00:00+00
d6dbd400-ca50-56ce-afb3-af60503f0d43	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	13	2.98	2026-03-04 07:00:00+00
ad53ed08-caa9-57e9-863b-4c38768b4e21	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	1	2.01	2026-03-03 22:00:00+00
66b68552-e4bb-5b65-b304-823e82ec1688	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	2	1.91	2026-03-03 23:00:00+00
208e3703-8daa-5eb5-bd74-0c07b29e19dd	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	3	2.16	2026-03-04 00:00:00+00
aa552817-26cb-5872-834a-4692c50759e5	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	4	2.06	2026-03-04 01:00:00+00
6c99931b-8702-5ba0-abc9-e20e8a14dbd5	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	5	1.96	2026-03-04 02:00:00+00
fa0a441a-8173-5312-9f87-2fed08b478ee	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	6	2.11	2026-03-04 03:00:00+00
5c6e2de0-1e00-566b-880a-bcce188a897d	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	7	2.06	2026-03-04 04:00:00+00
3400294a-45b9-5016-9abd-9548133ebd45	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	8	1.81	2026-03-04 05:00:00+00
8a66a8a7-1161-54c1-bb55-a160c992a2ff	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	9	1.86	2026-03-04 06:00:00+00
70a14c99-5e52-52ec-a7b5-efac3ea8467d	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	10	2.81	2026-03-04 07:00:00+00
8553c2c0-3d38-530c-ac52-862ff3d540aa	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	11	2.16	2026-03-04 08:00:00+00
1cec43b4-682a-5ae1-b870-7b4c591ab6e2	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	12	2.66	2026-03-04 09:00:00+00
89e53b88-3cdf-55d1-bb3d-f19282776cad	cccccccc-cccc-cccc-cccc-cccccccc2010	Comercial	13	2.86	2026-03-04 10:00:00+00
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."invoices" ("invoice_id", "client_id", "amount", "status", "due_date") FROM stdin;
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1001	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	4500.00	Paid	2026-03-01
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1002	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	4500.00	Pending	2026-04-01
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1003	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	8200.00	Pending	2026-03-15
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1004	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002	8200.00	Overdue	2026-02-15
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1005	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003	6100.00	Paid	2026-03-05
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1006	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004	7000.00	Pending	2026-03-20
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1007	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005	3900.00	Paid	2026-03-03
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1008	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005	3900.00	Pending	2026-04-03
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1009	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	5400.00	Pending	2026-03-25
\.


--
-- Data for Name: manager_notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."manager_notifications" ("notification_id", "client_id", "notification_type", "title", "message", "metadata", "is_read", "read_at", "created_at") FROM stdin;
0e7d0ec6-b8a1-4828-bca4-6d4b77a7353e	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	client_report_downloaded	Cliente baixou relatorio: DRPS report DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral - Construtora Aurora - (2026-03-03)	Construtora Aurora baixou um relatorio pelo portal do cliente.	{"reportId": "fbe1a737-56ef-4511-8742-1c8cc2e0a89b", "clientSlug": "construtora-aurora", "reportTitle": "DRPS report DRPS 2026 - Q2 Simulacao 20 colaboradores - TechCorp Brasil - Construtora Aurora - Empresa geral - Construtora Aurora - (2026-03-03)", "reportStatus": "ready", "clientCompanyName": "Construtora Aurora"}	t	2026-03-03 15:14:51.156+00	2026-03-03 14:16:07.100376+00
760d0932-daee-4de6-a18c-9887d37186ba	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006	client_reschedule_submitted	Cliente reagendou processo continuo (Programa de apoio a eventos traumaticos)	Construtora Aurora enviou 2 horario(s) para reagendamento.	{"programId": "dddddddd-dddd-dddd-dddd-dddddddd3008", "clientSlug": "construtora-aurora", "selectedSlots": [{"endsAt": "2026-04-01T14:00:00.000Z", "startsAt": "2026-04-01T13:00:00.000Z"}, {"endsAt": "2026-04-01T18:00:00.000Z", "startsAt": "2026-04-01T17:00:00.000Z"}], "clientProgramId": "255b5888-c445-4328-94f3-5ca7e7795d4b", "clientCompanyName": "Construtora Aurora", "availabilityRequestId": "0685f1e1-67a7-416e-a95d-e33714f6acd1"}	t	2026-03-03 15:14:51.66+00	2026-03-03 14:16:02.394283+00
a0533727-d225-4813-9aba-be39697f54c6	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	client_reschedule_submitted	Cliente reagendou processo continuo (Programa de clareza de papeis e autonomia)	TechCorp Brasil enviou 2 horario(s) para reagendamento.	{"programId": "dddddddd-dddd-dddd-dddd-dddddddd3004", "clientSlug": "techcorp-brasil", "selectedSlots": [{"endsAt": "2026-04-02T14:00:00.000Z", "startsAt": "2026-04-02T13:00:00.000Z"}, {"endsAt": "2026-04-02T18:00:00.000Z", "startsAt": "2026-04-02T17:00:00.000Z"}], "clientProgramId": "989ce79e-836d-4503-be3a-56c06966e630", "clientCompanyName": "TechCorp Brasil", "availabilityRequestId": "f15c9e2c-6727-444f-8879-b6476e8653de"}	t	2026-03-03 20:55:25.609+00	2026-03-03 15:13:35.721556+00
712f7c4e-b0ab-48cd-a8a5-baa4f9abd6fc	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	client_reschedule_submitted	Cliente reagendou processo continuo (Programa de comunicacao e relacionamento)	TechCorp Brasil enviou 1 horario(s) provisoriamente. Confirmacao do gestor pendente.	{"programId": "dddddddd-dddd-dddd-dddd-dddddddd3007", "clientSlug": "techcorp-brasil", "selectedSlots": [{"endsAt": "2026-03-17T18:00:00.000Z", "startsAt": "2026-03-17T17:00:00.000Z"}], "clientProgramId": "eb82aa73-0bf4-4c7d-adbf-91bc31030200", "clientCompanyName": "TechCorp Brasil", "availabilityRequestId": "e5775b86-cf5d-46bc-bfda-fc646fdea619"}	f	\N	2026-03-04 00:03:23.11232+00
15375f8a-0dfe-47a4-8b79-5ab35142db37	aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001	client_report_downloaded	Cliente baixou relatorio: Relatorio DRPS simulado - TechCorp Q2 (20 colaboradores)	TechCorp Brasil baixou um relatorio pelo portal do cliente.	{"reportId": "99000000-0000-0000-0000-000000000001", "clientSlug": "techcorp-brasil", "reportTitle": "Relatorio DRPS simulado - TechCorp Q2 (20 colaboradores)", "reportStatus": "ready", "clientCompanyName": "TechCorp Brasil"}	f	\N	2026-03-04 00:30:12.260831+00
\.


--
-- Data for Name: rate_limit_buckets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."rate_limit_buckets" ("survey_id", "ip_hash", "window_start", "hit_count", "created_at") FROM stdin;
\.


--
-- Data for Name: survey_group_dimensions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."survey_group_dimensions" ("id", "survey_id", "key", "label", "is_required", "created_at") FROM stdin;
11111111-1111-1111-1111-111111111101	11111111-1111-1111-1111-111111111001	sector	Setor	t	2026-03-01 19:25:56.586828+00
11111111-1111-1111-1111-111111111102	11111111-1111-1111-1111-111111111001	role	Cargo/Fun??o	f	2026-03-01 19:25:56.586828+00
f25ba1c2-14e7-416e-b8c6-67a25d08019b	11111111-1111-1111-1111-111111111002	sector	Setor	t	2026-03-01 20:44:43.786429+00
b13dad40-654d-42e3-bb94-54e0a8de9e10	11111111-1111-1111-1111-111111111002	role	Cargo/Fun??o	f	2026-03-01 20:44:43.786429+00
66516010-069f-47d9-a1ad-ba727da8b0ad	11111111-1111-1111-1111-111111111003	sector	Setor	t	2026-03-01 20:44:43.786429+00
982c01b7-798c-4a92-b337-cf702397e0fb	11111111-1111-1111-1111-111111111003	role	Cargo/Fun??o	f	2026-03-01 20:44:43.786429+00
4aa13d0c-0f01-4f41-aa11-2523f0577a34	11111111-1111-1111-1111-111111111004	sector	Setor	t	2026-03-01 20:44:43.786429+00
a81d5b2b-49c2-47fd-9b20-9df810650709	11111111-1111-1111-1111-111111111004	role	Cargo/Fun??o	f	2026-03-01 20:44:43.786429+00
bc50c26c-539d-4ff3-a42a-2dc4887ce411	38795b48-5b66-4576-bfa8-1ea0223e57b1	sector	Setor	t	2026-03-02 21:49:49.811597+00
d7f2fd53-af94-4b6b-a2b2-59b4a55a6891	38795b48-5b66-4576-bfa8-1ea0223e57b1	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
7c5a279d-400c-48f9-ac38-95781356922e	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	sector	Setor	t	2026-03-02 21:49:49.811597+00
44c06fd6-58e8-47dc-afc3-741595a7f9f9	2b62207e-fe2f-4a3a-8ad2-c99399e88d57	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
31a3e50b-a789-4364-8c03-a521fa0f38bd	cccccccc-cccc-cccc-cccc-cccccccc2001	sector	Setor	t	2026-03-02 21:49:49.811597+00
736d4e70-c1b3-4bb5-9b2a-460bc749a87f	cccccccc-cccc-cccc-cccc-cccccccc2001	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
e0aa20b1-c1a8-4a0c-ab6d-e37946d134a4	cccccccc-cccc-cccc-cccc-cccccccc2002	sector	Setor	t	2026-03-02 21:49:49.811597+00
5a5fd83c-e6e6-4923-962c-17be90c916da	cccccccc-cccc-cccc-cccc-cccccccc2002	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
d5df070a-1504-435b-923a-e5a9e7a2d532	cccccccc-cccc-cccc-cccc-cccccccc2003	sector	Setor	t	2026-03-02 21:49:49.811597+00
ef9e4f32-0b5d-4b0a-98f8-ad1e64bc1164	cccccccc-cccc-cccc-cccc-cccccccc2003	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
ce0d8cac-81d6-4881-acbc-e41e53b043e2	cccccccc-cccc-cccc-cccc-cccccccc2004	sector	Setor	t	2026-03-02 21:49:49.811597+00
a2438bb8-809f-4ff7-94f3-cce41308de30	cccccccc-cccc-cccc-cccc-cccccccc2004	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
7455a22c-1161-4a54-9e50-005e769b4781	cccccccc-cccc-cccc-cccc-cccccccc2010	sector	Setor	t	2026-03-02 21:49:49.811597+00
3d8e6f99-2c71-4100-8432-b5bef109e6a5	cccccccc-cccc-cccc-cccc-cccccccc2010	role	Cargo/Fun??o	f	2026-03-02 21:49:49.811597+00
914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	11111111-1111-1111-1111-111111111020	sector	Setor	t	2026-03-03 00:55:09.62241+00
ade56cf1-802a-4038-90db-e7a33f568aa4	11111111-1111-1111-1111-111111111020	role	Cargo/Fun??o	f	2026-03-03 00:55:09.62241+00
de1b4d59-464b-4e5a-bcd4-17cd6a148dde	898162b4-0df4-41c0-b660-08ae42921b5f	sector	Setor	t	2026-03-03 00:55:11.014189+00
215821c9-fb17-4d5b-bb0a-774ffef754e9	898162b4-0df4-41c0-b660-08ae42921b5f	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
f1beb34a-af28-4d9d-a336-5a289e9a9104	30b0db18-fb03-416d-9789-aff8abaaff0b	sector	Setor	t	2026-03-03 00:55:11.014189+00
1225e9ec-f097-4369-86a9-fa89057980ce	30b0db18-fb03-416d-9789-aff8abaaff0b	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
06337438-0fc5-4713-a91a-e56174e3e064	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	sector	Setor	t	2026-03-03 00:55:11.014189+00
bc027ee5-d2bf-463a-a3cc-1f2b68205d0c	46f08f19-844a-4ba0-bace-0a6a7dedfcbc	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
0b41494b-5fd9-440c-9989-538b620f5a2a	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	sector	Setor	t	2026-03-03 00:55:11.014189+00
9c336aff-1034-4c9a-89a4-51048fa77b9d	8ca47a1b-fe6a-4225-a9d4-d74917baff1f	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
0689e059-8f73-49d6-83df-82d56feacf1d	1a195567-49ff-43de-8d82-f39ee3c6f52a	sector	Setor	t	2026-03-03 00:55:11.014189+00
fa70ceeb-cb27-40c4-a9c1-b220e34ae5df	1a195567-49ff-43de-8d82-f39ee3c6f52a	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
28d82ca7-2a05-4623-a95f-06089213eaff	db78b658-294e-4cd9-9311-b92195697fb0	sector	Setor	t	2026-03-03 00:55:11.014189+00
5af2ba8c-f810-47c8-9d28-cae394ff2e65	db78b658-294e-4cd9-9311-b92195697fb0	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
bdb4add0-f8d4-4c40-a1fe-aa9e1d0e0004	a18c3be8-6893-4232-8ffa-e61f84049496	sector	Setor	t	2026-03-03 00:55:11.014189+00
a1cdbff1-4d81-4125-ae6a-bdd93f013fe9	a18c3be8-6893-4232-8ffa-e61f84049496	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
f1543bea-5247-48a1-aa3a-136aec681567	93559c7b-1836-48c5-bd6d-cd895e547b6e	sector	Setor	t	2026-03-03 00:55:11.014189+00
64d88d71-6dd7-4570-963f-a6f34680ca2b	93559c7b-1836-48c5-bd6d-cd895e547b6e	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
6e096de8-9b45-4054-82ac-efe8bd0dade5	d93d219a-610d-42f5-a5c9-d6d355b236f2	sector	Setor	t	2026-03-03 00:55:11.014189+00
8d1b268c-d818-41a6-b569-1649cd74aeb6	d93d219a-610d-42f5-a5c9-d6d355b236f2	role	Cargo/Fun??o	f	2026-03-03 00:55:11.014189+00
d60a9a50-7579-4e73-a794-04572fafc790	378e240e-0713-4a21-b150-55a601ea1901	sector	Setor	t	2026-03-03 13:40:30.140879+00
f597680d-e59c-4c33-a375-382f49f34050	378e240e-0713-4a21-b150-55a601ea1901	role	Cargo/Fun??o	f	2026-03-03 13:40:30.140879+00
\.


--
-- Data for Name: survey_group_options; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."survey_group_options" ("id", "dimension_id", "value", "label", "sort_order") FROM stdin;
84713702-e9b5-4edc-814d-803ae1e7a081	11111111-1111-1111-1111-111111111101	operacoes	Opera??es	1
6c2fbd5d-59ca-44a7-b78b-afdacea1cb6b	11111111-1111-1111-1111-111111111101	comercial	Comercial	2
d7f5b7de-c007-447d-9974-7da298304b4f	11111111-1111-1111-1111-111111111101	administrativo	Administrativo	3
b80d44da-5462-47d3-89dd-0df47cf84c35	11111111-1111-1111-1111-111111111101	ti	TI	4
228ae614-6a2e-4a80-bda4-c365f30dfee5	11111111-1111-1111-1111-111111111102	analista	Analista	1
6ec24b30-0301-42dc-b11a-1f73fda9c23b	11111111-1111-1111-1111-111111111102	lideranca	Lideran?a	2
20ad1033-5a96-4b99-870b-6d42371a9009	11111111-1111-1111-1111-111111111102	administrativo	Administrativo	3
f80e8f3a-5895-49af-b57b-8b94b03efb26	11111111-1111-1111-1111-111111111102	operacional	Operacional	4
8f602f55-3447-440b-a784-977c15270a69	f25ba1c2-14e7-416e-b8c6-67a25d08019b	administrativo	Administrativo	3
d3f0c035-0387-4df8-8b1e-5b882bce76ef	f25ba1c2-14e7-416e-b8c6-67a25d08019b	comercial	Comercial	2
42b07772-a10e-4e13-8efc-fa9cadfacade	f25ba1c2-14e7-416e-b8c6-67a25d08019b	operacoes	Opera??es	1
5ecb7e5e-dedb-48dc-a425-af23b2a9b59d	f25ba1c2-14e7-416e-b8c6-67a25d08019b	ti	TI	4
57a607a8-ed5e-4b0f-9469-fa50c564f681	66516010-069f-47d9-a1ad-ba727da8b0ad	administrativo	Administrativo	3
8eb2329f-e24d-4f3e-827f-67b466346eaf	66516010-069f-47d9-a1ad-ba727da8b0ad	comercial	Comercial	2
b650a5e2-4f99-4498-957f-fc0b24fbf5c3	66516010-069f-47d9-a1ad-ba727da8b0ad	operacoes	Opera??es	1
95205986-a7ce-4c6c-9963-367bd0f27aa5	66516010-069f-47d9-a1ad-ba727da8b0ad	ti	TI	4
b70d8f03-cdba-447c-bf9f-1499eb84fdb6	4aa13d0c-0f01-4f41-aa11-2523f0577a34	administrativo	Administrativo	3
4acd88db-5393-4ed9-8c4b-53031102c0da	4aa13d0c-0f01-4f41-aa11-2523f0577a34	comercial	Comercial	2
4070f84d-cbd4-4735-b853-7f4e634902f9	4aa13d0c-0f01-4f41-aa11-2523f0577a34	operacoes	Opera??es	1
8fa1d1cb-2dd8-48a5-b6f7-f3d4c0b339f7	4aa13d0c-0f01-4f41-aa11-2523f0577a34	ti	TI	4
5c1c7219-7b18-4db5-907a-1e0ca5b1dc90	b13dad40-654d-42e3-bb94-54e0a8de9e10	administrativo	Administrativo	3
60215bfa-efa7-4e85-b3fb-0ff566f7e5c4	b13dad40-654d-42e3-bb94-54e0a8de9e10	analista	Analista	1
798f60b0-489b-43da-a7c2-580cda564561	b13dad40-654d-42e3-bb94-54e0a8de9e10	lideranca	Lideran?a	2
c718e2a4-9077-4650-b599-c636f8cb8698	b13dad40-654d-42e3-bb94-54e0a8de9e10	operacional	Operacional	4
4c35a618-0989-4f30-b41b-fd966620719e	982c01b7-798c-4a92-b337-cf702397e0fb	administrativo	Administrativo	3
f217014d-e2b6-4ca0-ad40-957f143f3483	982c01b7-798c-4a92-b337-cf702397e0fb	analista	Analista	1
783099f7-00de-4856-a462-7b7dcc35b016	982c01b7-798c-4a92-b337-cf702397e0fb	lideranca	Lideran?a	2
c69e0898-4b1a-4995-bebe-17c43411f158	982c01b7-798c-4a92-b337-cf702397e0fb	operacional	Operacional	4
3889f8d2-0e6c-489a-9917-96f36b7b3de8	a81d5b2b-49c2-47fd-9b20-9df810650709	administrativo	Administrativo	3
59aff385-3e82-463a-ba5e-cad503ac38ff	a81d5b2b-49c2-47fd-9b20-9df810650709	analista	Analista	1
f684c49c-5e8c-4a93-8a73-45ff2d87667b	a81d5b2b-49c2-47fd-9b20-9df810650709	lideranca	Lideran?a	2
39a402d2-9e52-4606-8d85-ad9fdd5641eb	a81d5b2b-49c2-47fd-9b20-9df810650709	operacional	Operacional	4
215c6466-df2c-40e7-923a-2550893be7db	bc50c26c-539d-4ff3-a42a-2dc4887ce411	administrativo	Administrativo	3
9d4a3206-a548-41cf-bb26-8effae61746a	bc50c26c-539d-4ff3-a42a-2dc4887ce411	comercial	Comercial	2
26ef6db0-d4ac-465a-9754-b478770ff06f	bc50c26c-539d-4ff3-a42a-2dc4887ce411	operacoes	Opera??es	1
c05e433b-fc8e-467f-900f-954af22458bd	bc50c26c-539d-4ff3-a42a-2dc4887ce411	ti	TI	4
3041a1ff-9603-4603-8564-5b603d9bf4b5	d7f2fd53-af94-4b6b-a2b2-59b4a55a6891	administrativo	Administrativo	3
ba15b708-faf4-4738-ade6-94795527932a	d7f2fd53-af94-4b6b-a2b2-59b4a55a6891	analista	Analista	1
b83ab331-e078-4db7-90ec-e7cf3eab4831	d7f2fd53-af94-4b6b-a2b2-59b4a55a6891	lideranca	Lideran?a	2
5cba5b36-0a4b-447e-8c42-a8009c1aa850	d7f2fd53-af94-4b6b-a2b2-59b4a55a6891	operacional	Operacional	4
f9795a3f-c4d8-4389-a0c9-1eb3498930ee	7c5a279d-400c-48f9-ac38-95781356922e	administrativo	Administrativo	3
a4065456-69c5-409c-bb06-fed9705caa4c	7c5a279d-400c-48f9-ac38-95781356922e	comercial	Comercial	2
bab1c738-0601-43bc-b9d7-e8907e24429e	7c5a279d-400c-48f9-ac38-95781356922e	operacoes	Opera??es	1
da6b6aab-665b-40b6-8fd5-5a3b6390bf2e	7c5a279d-400c-48f9-ac38-95781356922e	ti	TI	4
d21d953b-5041-4302-9a9b-a7522b84bc27	44c06fd6-58e8-47dc-afc3-741595a7f9f9	administrativo	Administrativo	3
f3802749-e1fa-44c1-9eed-93203fc62ad6	44c06fd6-58e8-47dc-afc3-741595a7f9f9	analista	Analista	1
bb0b478b-4520-41e0-8f68-844d1a452342	44c06fd6-58e8-47dc-afc3-741595a7f9f9	lideranca	Lideran?a	2
2e5c0722-0d55-4315-a74f-3fc9d47d5f9f	44c06fd6-58e8-47dc-afc3-741595a7f9f9	operacional	Operacional	4
e66f09b5-af81-4e21-9b3c-4398bb182a82	31a3e50b-a789-4364-8c03-a521fa0f38bd	administrativo	Administrativo	3
9471ff87-d942-49d5-9ea3-15811e28584d	31a3e50b-a789-4364-8c03-a521fa0f38bd	comercial	Comercial	2
d109e637-9011-4de7-872d-9ae74515bebe	31a3e50b-a789-4364-8c03-a521fa0f38bd	operacoes	Opera??es	1
f231bce0-9323-4756-8264-08fbe1e6ae49	31a3e50b-a789-4364-8c03-a521fa0f38bd	ti	TI	4
70f2b70a-b20a-4d25-bb6d-acdcae46ed02	736d4e70-c1b3-4bb5-9b2a-460bc749a87f	administrativo	Administrativo	3
81f45048-6fa3-4b74-a9c9-a480e52967bc	736d4e70-c1b3-4bb5-9b2a-460bc749a87f	analista	Analista	1
b7f904ea-e0f3-47ff-9c88-fce7889407c2	736d4e70-c1b3-4bb5-9b2a-460bc749a87f	lideranca	Lideran?a	2
2475b071-6755-4bf6-b06d-2f35061337d3	736d4e70-c1b3-4bb5-9b2a-460bc749a87f	operacional	Operacional	4
0e500a53-8123-4831-8476-587b39a1beb2	e0aa20b1-c1a8-4a0c-ab6d-e37946d134a4	administrativo	Administrativo	3
6de2fc9c-96f7-4aa5-8052-765779cf2f6a	e0aa20b1-c1a8-4a0c-ab6d-e37946d134a4	comercial	Comercial	2
2d35b9f5-a96e-4f8a-8d1f-20aa6a23830d	e0aa20b1-c1a8-4a0c-ab6d-e37946d134a4	operacoes	Opera??es	1
8d020036-9393-4117-8f14-410495aeb38f	e0aa20b1-c1a8-4a0c-ab6d-e37946d134a4	ti	TI	4
699bf430-1ab1-4a34-bcd4-6b7770cfc50f	5a5fd83c-e6e6-4923-962c-17be90c916da	administrativo	Administrativo	3
8c0c27b3-c49f-4c52-994c-8bfdcab18110	5a5fd83c-e6e6-4923-962c-17be90c916da	analista	Analista	1
095ae45a-f002-4162-94d4-dffc7cb43d08	5a5fd83c-e6e6-4923-962c-17be90c916da	lideranca	Lideran?a	2
37cb99c3-fde1-4f3d-bd5b-6459d9f21973	5a5fd83c-e6e6-4923-962c-17be90c916da	operacional	Operacional	4
36b60345-7bee-4d96-8384-9bbabd0bbfd3	d5df070a-1504-435b-923a-e5a9e7a2d532	administrativo	Administrativo	3
3c1d6b8f-4ff2-429a-8efe-281fec667058	d5df070a-1504-435b-923a-e5a9e7a2d532	comercial	Comercial	2
4e22b79d-a558-4eb2-a351-a2041e24be6c	d5df070a-1504-435b-923a-e5a9e7a2d532	operacoes	Opera??es	1
4f997deb-600e-4c92-acbb-82a462ff07b0	d5df070a-1504-435b-923a-e5a9e7a2d532	ti	TI	4
2283c2f5-710a-42a4-8af7-4e0d394e0791	ef9e4f32-0b5d-4b0a-98f8-ad1e64bc1164	administrativo	Administrativo	3
f4527fa3-f317-4d70-864e-a0fbbc1763c8	ef9e4f32-0b5d-4b0a-98f8-ad1e64bc1164	analista	Analista	1
1071ac6c-1da8-4278-a10a-6c8004ab7fb4	ef9e4f32-0b5d-4b0a-98f8-ad1e64bc1164	lideranca	Lideran?a	2
a7042920-4688-48a3-8608-a0535d796837	ef9e4f32-0b5d-4b0a-98f8-ad1e64bc1164	operacional	Operacional	4
eb55efc2-3c5a-400d-bda3-9ac0c573836b	ce0d8cac-81d6-4881-acbc-e41e53b043e2	administrativo	Administrativo	3
9df99e21-369f-4f38-a79c-834e1960d26d	ce0d8cac-81d6-4881-acbc-e41e53b043e2	comercial	Comercial	2
4e29d5b6-03bd-4d7a-a57b-9d0619a47651	ce0d8cac-81d6-4881-acbc-e41e53b043e2	operacoes	Opera??es	1
cf806789-686f-4854-806d-7e2e406d4588	ce0d8cac-81d6-4881-acbc-e41e53b043e2	ti	TI	4
72baf083-444d-4323-b5b9-92762f51c55d	a2438bb8-809f-4ff7-94f3-cce41308de30	administrativo	Administrativo	3
89bb875a-090b-4193-a624-55e4fd511fd3	a2438bb8-809f-4ff7-94f3-cce41308de30	analista	Analista	1
00d428ac-5e0d-49c9-af40-de3b8af582b1	a2438bb8-809f-4ff7-94f3-cce41308de30	lideranca	Lideran?a	2
b443b32e-e84a-498a-9467-c9f7a0fc0c8c	a2438bb8-809f-4ff7-94f3-cce41308de30	operacional	Operacional	4
36e2a6f0-e722-45d8-b234-b0c9f72d9b2f	7455a22c-1161-4a54-9e50-005e769b4781	administrativo	Administrativo	3
15dfc847-c2b9-43e1-a0dc-8e396990e409	7455a22c-1161-4a54-9e50-005e769b4781	comercial	Comercial	2
be2d9758-778d-4fea-ac70-1d8d6b25410d	7455a22c-1161-4a54-9e50-005e769b4781	operacoes	Opera??es	1
17670d8b-0e6f-4c44-843f-57b5bee9b87a	7455a22c-1161-4a54-9e50-005e769b4781	ti	TI	4
5dfbce39-5de8-41c9-b244-2f757827a576	3d8e6f99-2c71-4100-8432-b5bef109e6a5	administrativo	Administrativo	3
4b274abe-ee5c-44cd-89e6-5d3be506fcdf	3d8e6f99-2c71-4100-8432-b5bef109e6a5	analista	Analista	1
8411f4a8-2b01-431d-8d37-9344e0c60ef4	3d8e6f99-2c71-4100-8432-b5bef109e6a5	lideranca	Lideran?a	2
4c898f4b-096e-41df-8cba-e6187ffef01b	3d8e6f99-2c71-4100-8432-b5bef109e6a5	operacional	Operacional	4
9a5e5215-5d67-4c96-a51e-4940c4dbecd7	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	operacoes	Opera??es	1
34897662-f341-4342-8941-5415f041bbb6	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	comercial	Comercial	2
1632d02f-32d7-49d1-8eec-ccb969ab83b0	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	administrativo	Administrativo	3
cca31936-0de1-459f-8797-48dada910beb	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	ti	TI	4
c18f6717-3f0c-448d-a0ae-1437033b4a0b	ade56cf1-802a-4038-90db-e7a33f568aa4	analista	Analista	1
62ad1eee-e1ad-4a5b-a05a-67014b698d5a	ade56cf1-802a-4038-90db-e7a33f568aa4	lideranca	Lideran?a	2
9b3dda12-da2e-4ce8-8a1f-e70ef2867fbb	ade56cf1-802a-4038-90db-e7a33f568aa4	administrativo	Administrativo	3
71176b5e-e40c-4422-8446-c13432d6dc88	ade56cf1-802a-4038-90db-e7a33f568aa4	operacional	Operacional	4
b08b2d45-ccaf-4700-a10b-5d18f281df7d	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	Tecnologia	Tecnologia	1
6d7fa183-8e61-46eb-9ab1-6d75c4ff4d2a	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	Financeiro	Financeiro	2
a2fe2b6b-5442-4513-89d7-99df0198bda0	914a3bbf-bb1d-467f-9f2c-3cc93c88a3b5	Comercial	Comercial	3
c5ee18d3-2ef8-4941-ba9d-83bd894623f0	de1b4d59-464b-4e5a-bcd4-17cd6a148dde	administrativo	Administrativo	3
fd970cf4-9c9d-4c69-961e-6652d8b720e2	de1b4d59-464b-4e5a-bcd4-17cd6a148dde	comercial	Comercial	2
f49c06cc-fe48-4072-8306-2ae55492920d	de1b4d59-464b-4e5a-bcd4-17cd6a148dde	operacoes	Opera??es	1
5ee89e7f-b0b3-424e-a0dd-44ea535bdb15	de1b4d59-464b-4e5a-bcd4-17cd6a148dde	ti	TI	4
6ebe1a31-f574-40f5-917f-84ccd2bd6302	215821c9-fb17-4d5b-bb0a-774ffef754e9	administrativo	Administrativo	3
02767569-fa4a-490f-b1e6-b066db3e9098	215821c9-fb17-4d5b-bb0a-774ffef754e9	analista	Analista	1
d5531a6f-bc5d-4ace-b592-d719e4a2e53f	215821c9-fb17-4d5b-bb0a-774ffef754e9	lideranca	Lideran?a	2
16ca6451-6bcc-45ec-a3fb-c86e36aad20b	215821c9-fb17-4d5b-bb0a-774ffef754e9	operacional	Operacional	4
f951d951-d82d-4c42-b70b-bee2d149989c	f1beb34a-af28-4d9d-a336-5a289e9a9104	administrativo	Administrativo	3
8edf37a2-ff59-4634-940a-24b159f6a77a	f1beb34a-af28-4d9d-a336-5a289e9a9104	comercial	Comercial	2
7b8196db-04bc-4367-9efa-542f9232bd1f	f1beb34a-af28-4d9d-a336-5a289e9a9104	operacoes	Opera??es	1
0777cdde-dccc-4e02-8319-073a5a97052a	f1beb34a-af28-4d9d-a336-5a289e9a9104	ti	TI	4
24a05201-796d-4d04-8ad3-19eab8c9c500	1225e9ec-f097-4369-86a9-fa89057980ce	administrativo	Administrativo	3
c829166f-b0e2-4934-9e76-6d850ceacae5	1225e9ec-f097-4369-86a9-fa89057980ce	analista	Analista	1
4a35068f-6326-4653-8be0-9024b45e12ae	1225e9ec-f097-4369-86a9-fa89057980ce	lideranca	Lideran?a	2
701fdf49-b4f3-4359-af10-e4617cd0f084	1225e9ec-f097-4369-86a9-fa89057980ce	operacional	Operacional	4
b534198c-66d2-4084-bafc-6e72a11fc289	06337438-0fc5-4713-a91a-e56174e3e064	administrativo	Administrativo	3
1fa8c251-ca33-410f-b5c5-8c3dddfb4bb8	06337438-0fc5-4713-a91a-e56174e3e064	comercial	Comercial	2
c31edfbb-ec89-43f9-be7c-2a8ca6f0099e	06337438-0fc5-4713-a91a-e56174e3e064	operacoes	Opera??es	1
f80a964e-5f50-40b5-9546-41533a5c7d79	06337438-0fc5-4713-a91a-e56174e3e064	ti	TI	4
10114f81-b58c-4bb0-bc92-05b5d96b41d2	bc027ee5-d2bf-463a-a3cc-1f2b68205d0c	administrativo	Administrativo	3
49501595-4f84-4ead-b845-78d4ef1d8b7e	bc027ee5-d2bf-463a-a3cc-1f2b68205d0c	analista	Analista	1
05622cb0-f0c9-4206-b579-863d7b29d934	bc027ee5-d2bf-463a-a3cc-1f2b68205d0c	lideranca	Lideran?a	2
f5259600-69e8-4461-a22e-a0d63db15bae	bc027ee5-d2bf-463a-a3cc-1f2b68205d0c	operacional	Operacional	4
bd5e69d8-c074-4fa8-a99b-2a115a2e1fe3	0b41494b-5fd9-440c-9989-538b620f5a2a	administrativo	Administrativo	3
fbd1c4e5-4a26-4fe1-9b85-99eec2f6e6ca	0b41494b-5fd9-440c-9989-538b620f5a2a	comercial	Comercial	2
82e5e73f-03d9-46df-9d76-d6a02dc3fd88	0b41494b-5fd9-440c-9989-538b620f5a2a	operacoes	Opera??es	1
14e732bc-53bb-498d-93e2-1d33197c5003	0b41494b-5fd9-440c-9989-538b620f5a2a	ti	TI	4
3468d1c4-b158-4e96-9dd6-223ec2fa6d73	9c336aff-1034-4c9a-89a4-51048fa77b9d	administrativo	Administrativo	3
9fe986bc-eac8-4124-ba5d-8897ee4deed0	9c336aff-1034-4c9a-89a4-51048fa77b9d	analista	Analista	1
09220704-293a-42cd-b925-e63e07b6822a	9c336aff-1034-4c9a-89a4-51048fa77b9d	lideranca	Lideran?a	2
d058c680-5922-4ad2-9e4e-6175b7a1313f	9c336aff-1034-4c9a-89a4-51048fa77b9d	operacional	Operacional	4
658df30e-d8bd-41db-9430-9b56621f3588	0689e059-8f73-49d6-83df-82d56feacf1d	administrativo	Administrativo	3
b2eeb3a1-5a2f-4639-abc3-04760591afe6	0689e059-8f73-49d6-83df-82d56feacf1d	comercial	Comercial	2
d8167d15-85ea-4e81-9689-6f85f010aaad	0689e059-8f73-49d6-83df-82d56feacf1d	operacoes	Opera??es	1
a80113bd-8fce-41b8-ba37-42f0c4adbc21	0689e059-8f73-49d6-83df-82d56feacf1d	ti	TI	4
6c2b4d7f-5341-468a-a84a-5bd8da85def8	fa70ceeb-cb27-40c4-a9c1-b220e34ae5df	administrativo	Administrativo	3
f5ad0ea2-23c3-49f6-87f5-1daf78e2145f	fa70ceeb-cb27-40c4-a9c1-b220e34ae5df	analista	Analista	1
d4ed53f5-4eb0-47e8-94de-ddffc799c6f7	fa70ceeb-cb27-40c4-a9c1-b220e34ae5df	lideranca	Lideran?a	2
47cf3a93-0669-4bd4-8b97-5aabe919a754	fa70ceeb-cb27-40c4-a9c1-b220e34ae5df	operacional	Operacional	4
43a9bf75-c05b-4913-be47-034fdd8485ae	28d82ca7-2a05-4623-a95f-06089213eaff	administrativo	Administrativo	3
ca668878-c65b-4b77-acc8-45f5e507fc75	28d82ca7-2a05-4623-a95f-06089213eaff	comercial	Comercial	2
ba0b4653-a003-45a2-adf6-ed6037586343	28d82ca7-2a05-4623-a95f-06089213eaff	operacoes	Opera??es	1
64e7d995-b3da-4794-8783-b28efa5f2f23	28d82ca7-2a05-4623-a95f-06089213eaff	ti	TI	4
9a64bf54-41e7-495a-8168-e0528f6f87c0	5af2ba8c-f810-47c8-9d28-cae394ff2e65	administrativo	Administrativo	3
443f93e6-caa7-4870-9b96-28ad0a556c18	5af2ba8c-f810-47c8-9d28-cae394ff2e65	analista	Analista	1
f39ff619-079d-4089-93f4-c8fa07b43a33	5af2ba8c-f810-47c8-9d28-cae394ff2e65	lideranca	Lideran?a	2
0e7bef1d-5816-4ec2-b635-0dcfcc4df03a	5af2ba8c-f810-47c8-9d28-cae394ff2e65	operacional	Operacional	4
6b1f13fd-8718-4268-8dfd-a43273c871e6	bdb4add0-f8d4-4c40-a1fe-aa9e1d0e0004	administrativo	Administrativo	3
c3b02118-7d17-41f4-8ffe-7cc3af9f4931	bdb4add0-f8d4-4c40-a1fe-aa9e1d0e0004	comercial	Comercial	2
00dffea8-0b8a-4c81-b84e-4c1f40c8fa0b	bdb4add0-f8d4-4c40-a1fe-aa9e1d0e0004	operacoes	Opera??es	1
be46ff1a-63d7-4f80-aecf-0a2c5eee86fa	bdb4add0-f8d4-4c40-a1fe-aa9e1d0e0004	ti	TI	4
f5a262a1-fa1e-465a-8e1a-865fe4ad23d6	a1cdbff1-4d81-4125-ae6a-bdd93f013fe9	administrativo	Administrativo	3
70e791a3-7a7c-413d-950a-5e74411f1222	a1cdbff1-4d81-4125-ae6a-bdd93f013fe9	analista	Analista	1
a12c4af8-6780-4343-9757-fd20a5eac739	a1cdbff1-4d81-4125-ae6a-bdd93f013fe9	lideranca	Lideran?a	2
569d0a32-2d79-463d-864d-64f4b4795519	a1cdbff1-4d81-4125-ae6a-bdd93f013fe9	operacional	Operacional	4
0ee75ca1-88c3-4f16-93d8-85e770cef301	f1543bea-5247-48a1-aa3a-136aec681567	administrativo	Administrativo	3
29c4f841-17e4-4753-b955-0f55f3947ea4	f1543bea-5247-48a1-aa3a-136aec681567	comercial	Comercial	2
7b061331-1313-41d1-ad8e-d5c19754776d	f1543bea-5247-48a1-aa3a-136aec681567	operacoes	Opera??es	1
3a984a78-7527-4fc0-bd1e-03c8bc351d24	f1543bea-5247-48a1-aa3a-136aec681567	ti	TI	4
44b653dd-ce2d-47cf-a13c-e62b1df53644	64d88d71-6dd7-4570-963f-a6f34680ca2b	administrativo	Administrativo	3
f6638054-f5ce-4433-a71b-893f41b99a32	64d88d71-6dd7-4570-963f-a6f34680ca2b	analista	Analista	1
25b3070e-b888-4303-b209-ad80ad523899	64d88d71-6dd7-4570-963f-a6f34680ca2b	lideranca	Lideran?a	2
e85a8e8e-fc1b-40bc-90b7-d0c9226f2dde	64d88d71-6dd7-4570-963f-a6f34680ca2b	operacional	Operacional	4
863f4371-8a41-4b5e-b497-df32b78b186b	6e096de8-9b45-4054-82ac-efe8bd0dade5	administrativo	Administrativo	3
09e9ca2a-3000-4558-8c5d-535b35e7e8e6	6e096de8-9b45-4054-82ac-efe8bd0dade5	comercial	Comercial	2
4c993fff-20d9-429e-bee7-0de8d834afe1	6e096de8-9b45-4054-82ac-efe8bd0dade5	operacoes	Opera??es	1
80afaa75-00ab-4a37-9da7-85e11f312ecd	6e096de8-9b45-4054-82ac-efe8bd0dade5	ti	TI	4
05a602aa-55d6-47fe-a65c-b95f8b639c7f	8d1b268c-d818-41a6-b569-1649cd74aeb6	administrativo	Administrativo	3
22e0a3e9-61e4-4c4e-a424-4c77bd66ff4d	8d1b268c-d818-41a6-b569-1649cd74aeb6	analista	Analista	1
a76a559d-8aeb-44cc-aecc-01b1f9fafb38	8d1b268c-d818-41a6-b569-1649cd74aeb6	lideranca	Lideran?a	2
7b624ee9-50f7-484e-a38f-d8683948a218	8d1b268c-d818-41a6-b569-1649cd74aeb6	operacional	Operacional	4
8f515a6f-4bbb-4f20-be6d-1fc295365ab0	d60a9a50-7579-4e73-a794-04572fafc790	administrativo	Administrativo	3
408d4412-913e-4de4-8156-e04383af9620	d60a9a50-7579-4e73-a794-04572fafc790	comercial	Comercial	2
c9c9d61f-972d-4651-8625-ce47990d760e	d60a9a50-7579-4e73-a794-04572fafc790	operacoes	Opera??es	1
f24556a1-e47f-4635-8dc3-f786fe204bde	d60a9a50-7579-4e73-a794-04572fafc790	ti	TI	4
cad1633b-e11b-4cbe-943a-6449e67c0812	f597680d-e59c-4c33-a375-382f49f34050	administrativo	Administrativo	3
f285b3d4-d487-4cda-ba35-24ef92585987	f597680d-e59c-4c33-a375-382f49f34050	analista	Analista	1
95ae3ba9-f99b-4104-bd3e-6d0544965643	f597680d-e59c-4c33-a375-382f49f34050	lideranca	Lideran?a	2
11bcd9fb-ec21-475d-96b8-3126c97fc81b	f597680d-e59c-4c33-a375-382f49f34050	operacional	Operacional	4
c8a6f112-159b-4fdd-b22a-ed9c44a1022b	d60a9a50-7579-4e73-a794-04572fafc790	dfgsdfgd	dfgsdfgd	6
4a300b35-c4cd-456b-b2b2-d5b3e75943c7	66516010-069f-47d9-a1ad-ba727da8b0ad	Operacoes	Operacoes	5
3ac62dfb-cad8-4b33-9a4c-07acf5e36c9c	66516010-069f-47d9-a1ad-ba727da8b0ad	Manutencao	Manutencao	6
5358b44c-9af1-457f-835a-b36d6c2d4722	66516010-069f-47d9-a1ad-ba727da8b0ad	Seguranca	Seguranca	7
\.


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") FROM stdin;
program-materials	program-materials	\N	2026-03-03 00:55:11.454153+00	2026-03-03 00:55:11.454153+00	t	f	15728640	{application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,image/png,image/jpeg}	\N	STANDARD
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."buckets_analytics" ("name", "type", "format", "created_at", "updated_at", "id", "deleted_at") FROM stdin;
\.


--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."buckets_vectors" ("id", "type", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."objects" ("id", "bucket_id", "name", "owner", "created_at", "updated_at", "last_accessed_at", "metadata", "version", "owner_id", "user_metadata") FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."s3_multipart_uploads" ("id", "in_progress_size", "upload_signature", "bucket_id", "key", "version", "owner_id", "created_at", "user_metadata") FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."s3_multipart_uploads_parts" ("id", "upload_id", "size", "part_number", "bucket_id", "key", "etag", "owner_id", "version", "created_at") FROM stdin;
\.


--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."vector_indexes" ("id", "name", "bucket_id", "data_type", "dimension", "distance_metric", "metadata_configuration", "created_at", "updated_at") FROM stdin;
\.


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict 9RgBQxXhaT2VKzYCe9LMRYHJtdhGLruaSHckJH7KRRd6d8coT0n0FvjPB2plWI4

RESET ALL;

