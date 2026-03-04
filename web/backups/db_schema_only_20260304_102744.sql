


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































