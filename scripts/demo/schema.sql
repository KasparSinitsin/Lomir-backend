-- Lomir database schema: STRUCTURE ONLY, no data.
--
-- Taken with `pg_dump --schema-only` from a fully migrated database on 2026-10-11 and edited in four places:
-- the psql `\restrict` lines, the unused `ltree` extension, the pg_dump version stamps and the line
-- `SET transaction_timeout` (it only exists from PostgreSQL 17 on and has no effect here) were removed.
--
-- Loaded by `npm run demo-db` (scripts/demo-database.js) into an EMPTY, LOCAL database. The migrations in
-- src/database/migrations are increments on top of this state and are already applied here.
-- Tested with PostgreSQL 17.
--
-- Do not edit by hand. After a migration that changes the structure, take the structure again.
--
-- PostgreSQL database dump
--



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


SET default_table_access_method = heap;

--
-- Name: badge_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badge_awards (
    id bigint NOT NULL,
    awarded_to_user_id bigint NOT NULL,
    badge_id bigint NOT NULL,
    awarded_by_user_id bigint,
    credits smallint DEFAULT 1 NOT NULL,
    reason text,
    context_type text,
    context_id bigint,
    team_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tag_id integer,
    custom_team_name character varying(100) DEFAULT NULL::character varying,
    project_name character varying(100) DEFAULT NULL::character varying,
    CONSTRAINT badge_awards_credits_check CHECK ((credits = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: badge_awards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.badge_awards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: badge_awards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badge_awards_id_seq OWNED BY public.badge_awards.id;


--
-- Name: badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badges (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    category character varying(50),
    image_url character varying(255),
    color character varying(20),
    cat_image_url text
);


--
-- Name: badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badges_id_seq OWNED BY public.badges.id;


--
-- Name: contact_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_reports (
    id bigint NOT NULL,
    reference_code text NOT NULL,
    reporter_name text NOT NULL,
    reporter_email text NOT NULL,
    topic text NOT NULL,
    message text NOT NULL,
    attachment_metadata jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    email_status text DEFAULT 'not_attempted'::text NOT NULL,
    email_message_id text,
    email_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_reports_email_status_check CHECK ((email_status = ANY (ARRAY['not_attempted'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT contact_reports_status_check CHECK ((status = ANY (ARRAY['received'::text, 'under_review'::text, 'action_taken'::text, 'closed'::text])))
);


--
-- Name: contact_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_reports_id_seq OWNED BY public.contact_reports.id;


--
-- Name: message_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reads (
    message_id bigint NOT NULL,
    user_id integer NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    sender_id integer,
    receiver_id integer,
    team_id integer,
    content text,
    sent_at timestamp with time zone DEFAULT now(),
    read_at timestamp with time zone,
    image_url character varying(500) DEFAULT NULL::character varying,
    file_url character varying(500),
    file_name character varying(255),
    file_size integer,
    file_expires_at timestamp with time zone,
    file_deleted_at timestamp with time zone,
    cloudinary_public_id text,
    deleted_at timestamp with time zone,
    deleted_by integer,
    edited_at timestamp with time zone,
    edited_by integer,
    reply_to_id integer
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    reference_type character varying(50),
    reference_id integer,
    team_id integer,
    actor_id integer,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: tag_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_categories (
    id integer NOT NULL,
    supercategory_id integer NOT NULL,
    name text NOT NULL,
    CONSTRAINT tag_categories_name_clean CHECK (((name <> ''::text) AND (name = btrim(name))))
);


--
-- Name: tag_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tag_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tag_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tag_categories_id_seq OWNED BY public.tag_categories.id;


--
-- Name: tag_category_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_category_translations (
    category_id integer NOT NULL,
    language character varying(2) NOT NULL,
    name text NOT NULL,
    CONSTRAINT tag_category_translations_language_check CHECK (((language)::text ~ '^[a-z]{2}$'::text)),
    CONSTRAINT tag_category_translations_name_clean CHECK (((name <> ''::text) AND (name = btrim(name))))
);


--
-- Name: tag_supercategories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_supercategories (
    id integer NOT NULL,
    name text NOT NULL,
    CONSTRAINT tag_supercategories_name_clean CHECK (((name <> ''::text) AND (name = btrim(name))))
);


--
-- Name: tag_supercategories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tag_supercategories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tag_supercategories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tag_supercategories_id_seq OWNED BY public.tag_supercategories.id;


--
-- Name: tag_supercategory_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_supercategory_translations (
    supercategory_id integer NOT NULL,
    language character varying(2) NOT NULL,
    name text NOT NULL,
    CONSTRAINT tag_supercategory_translations_language_check CHECK (((language)::text ~ '^[a-z]{2}$'::text)),
    CONSTRAINT tag_supercategory_translations_name_clean CHECK (((name <> ''::text) AND (name = btrim(name))))
);


--
-- Name: tag_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_translations (
    tag_id integer NOT NULL,
    language character varying(2) NOT NULL,
    name text NOT NULL,
    CONSTRAINT tag_translations_language_check CHECK (((language)::text ~ '^[a-z]{2}$'::text)),
    CONSTRAINT tag_translations_name_clean CHECK (((name <> ''::text) AND (name = btrim(name))))
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id integer NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    parent_id integer,
    supercategory text NOT NULL,
    created_by integer,
    is_system boolean DEFAULT true,
    status character varying(50) DEFAULT 'approved'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    supercategory_id integer,
    category_id integer
);


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: team_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_applications (
    id integer NOT NULL,
    team_id integer,
    applicant_id integer,
    message text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    reviewed_at timestamp without time zone,
    reviewed_by integer,
    role_id integer,
    CONSTRAINT team_applications_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'draft'::character varying])::text[])))
);


--
-- Name: team_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_applications_id_seq OWNED BY public.team_applications.id;


--
-- Name: team_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_invitations (
    id integer NOT NULL,
    team_id integer NOT NULL,
    inviter_id integer NOT NULL,
    invitee_id integer NOT NULL,
    message text,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    responded_at timestamp without time zone,
    role_id integer,
    CONSTRAINT team_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying, 'canceled'::character varying])::text[])))
);


--
-- Name: team_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_invitations_id_seq OWNED BY public.team_invitations.id;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id integer NOT NULL,
    team_id integer,
    user_id integer,
    role character varying(50) DEFAULT 'member'::character varying,
    joined_at timestamp without time zone DEFAULT now()
);


--
-- Name: team_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_members_id_seq OWNED BY public.team_members.id;


--
-- Name: team_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_tags (
    id integer NOT NULL,
    team_id integer,
    tag_id integer
);


--
-- Name: team_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_tags_id_seq OWNED BY public.team_tags.id;


--
-- Name: team_vacant_role_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_vacant_role_badges (
    id integer NOT NULL,
    role_id integer NOT NULL,
    badge_id integer NOT NULL
);


--
-- Name: team_vacant_role_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_vacant_role_badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_vacant_role_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_vacant_role_badges_id_seq OWNED BY public.team_vacant_role_badges.id;


--
-- Name: team_vacant_role_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_vacant_role_tags (
    id integer NOT NULL,
    role_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: team_vacant_role_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_vacant_role_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_vacant_role_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_vacant_role_tags_id_seq OWNED BY public.team_vacant_role_tags.id;


--
-- Name: team_vacant_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_vacant_roles (
    id integer NOT NULL,
    team_id integer NOT NULL,
    created_by integer,
    role_name character varying(100) NOT NULL,
    bio text,
    postal_code character varying(20),
    city character varying(100),
    country character varying(100),
    state character varying(100),
    latitude double precision,
    longitude double precision,
    max_distance_km integer,
    is_remote boolean DEFAULT false,
    status character varying(20) DEFAULT 'open'::character varying,
    filled_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_synthetic boolean DEFAULT false NOT NULL,
    district character varying(255),
    CONSTRAINT team_vacant_roles_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'filled'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: team_vacant_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_vacant_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_vacant_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_vacant_roles_id_seq OWNED BY public.team_vacant_roles.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    owner_id integer,
    teamavatar_url character varying(255),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    postal_code character varying(20),
    latitude numeric(10,8),
    longitude numeric(11,8),
    max_members integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    archived_at timestamp without time zone,
    is_public boolean DEFAULT true,
    city character varying(255),
    country character varying(10),
    state character varying(255),
    is_remote boolean DEFAULT false,
    teamavatar_file_id text,
    is_synthetic boolean DEFAULT false NOT NULL,
    district character varying(255)
);


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: user_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_badges (
    id integer NOT NULL,
    user_id integer,
    badge_id integer,
    awarded_by integer,
    awarded_at timestamp without time zone DEFAULT now(),
    team_id integer
);


--
-- Name: user_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_badges_id_seq OWNED BY public.user_badges.id;


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    blocker_id integer NOT NULL,
    blocked_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id))
);


--
-- Name: user_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_tags (
    id integer NOT NULL,
    user_id integer,
    tag_id integer,
    interest_level integer,
    experience_level integer,
    badge_credits integer DEFAULT 0,
    dominant_badge_category character varying(50),
    source character varying(10) DEFAULT 'user'::character varying NOT NULL,
    CONSTRAINT user_tags_experience_level_check CHECK (((experience_level >= 1) AND (experience_level <= 3))),
    CONSTRAINT user_tags_interest_level_check CHECK (((interest_level >= 1) AND (interest_level <= 3))),
    CONSTRAINT user_tags_source_check CHECK (((source)::text = ANY ((ARRAY['user'::character varying, 'award'::character varying])::text[])))
);


--
-- Name: user_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_tags_id_seq OWNED BY public.user_tags.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(50),
    last_name character varying(50),
    bio text,
    avatar_url character varying(255),
    postal_code character varying(20),
    latitude numeric(10,8),
    longitude numeric(11,8),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_public boolean DEFAULT true,
    city character varying(255),
    email_verified boolean DEFAULT false,
    verification_token character varying(255),
    verification_token_expires timestamp with time zone,
    password_reset_token character varying(255),
    password_reset_expires timestamp with time zone,
    country character varying(100),
    state character varying(100),
    avatar_file_id text,
    is_synthetic boolean DEFAULT false NOT NULL,
    hide_badges boolean DEFAULT false,
    hidden_badge_ids integer[] DEFAULT '{}'::integer[],
    hidden_award_ids integer[] DEFAULT '{}'::integer[],
    district character varying(255),
    accepted_terms_at timestamp with time zone,
    accepted_privacy_at timestamp with time zone,
    confirmed_age_16_at timestamp with time zone,
    accepted_terms_version text,
    accepted_privacy_version text,
    confirmed_age_16_version text,
    pending_email text,
    email_change_token text,
    email_change_token_expires timestamp with time zone,
    password_changed_at timestamp with time zone,
    preferred_language character varying(10)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_user_badge_credit_totals; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_badge_credit_totals AS
 SELECT awarded_to_user_id AS user_id,
    badge_id,
    (sum(credits))::integer AS total_credits,
    max(created_at) AS last_awarded_at
   FROM public.badge_awards ba
  GROUP BY awarded_to_user_id, badge_id;


--
-- Name: v_user_badges_with_category_totals; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.v_user_badges_with_category_totals AS
 SELECT base.user_id,
    base.badge_id,
    base.badge_name,
    base.category,
    base.badge_color,
    base.cat_image_url,
    base.total_credits,
    base.award_count,
    base.awarder_count,
    base.last_awarded_at,
    base.category_total_credits,
    base.category_award_count,
    cat_awarders.category_awarder_count
   FROM (( SELECT ba.awarded_to_user_id AS user_id,
            b.id AS badge_id,
            b.name AS badge_name,
            b.category,
            b.color AS badge_color,
            b.cat_image_url,
            sum(ba.credits) AS total_credits,
            count(*) AS award_count,
            count(DISTINCT ba.awarded_by_user_id) AS awarder_count,
            max(ba.created_at) AS last_awarded_at,
            sum(sum(ba.credits)) OVER (PARTITION BY ba.awarded_to_user_id, b.category) AS category_total_credits,
            sum(count(*)) OVER (PARTITION BY ba.awarded_to_user_id, b.category) AS category_award_count
           FROM (public.badge_awards ba
             JOIN public.badges b ON ((ba.badge_id = b.id)))
          GROUP BY ba.awarded_to_user_id, b.id, b.name, b.category, b.color, b.cat_image_url) base
     JOIN ( SELECT ba.awarded_to_user_id AS user_id,
            b.category,
            count(DISTINCT ba.awarded_by_user_id) AS category_awarder_count
           FROM (public.badge_awards ba
             JOIN public.badges b ON ((ba.badge_id = b.id)))
          GROUP BY ba.awarded_to_user_id, b.category) cat_awarders ON (((base.user_id = cat_awarders.user_id) AND ((base.category)::text = (cat_awarders.category)::text))))
  WITH NO DATA;


--
-- Name: v_user_badges_with_totals; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_badges_with_totals AS
 SELECT t.user_id,
    b.id AS badge_id,
    b.name AS badge_name,
    b.category,
    b.color AS badge_color,
    b.cat_image_url,
    t.total_credits,
    t.last_awarded_at
   FROM (public.v_user_badge_credit_totals t
     JOIN public.badges b ON ((b.id = t.badge_id)));


--
-- Name: v_user_category_credit_totals; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_category_credit_totals AS
 SELECT ba.awarded_to_user_id AS user_id,
    b.category,
    (sum(ba.credits))::integer AS total_credits
   FROM (public.badge_awards ba
     JOIN public.badges b ON ((b.id = ba.badge_id)))
  GROUP BY ba.awarded_to_user_id, b.category;


--
-- Name: v_user_tag_badge_credits; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_tag_badge_credits AS
 SELECT ba.awarded_to_user_id AS user_id,
    ba.tag_id,
    b.category AS badge_category,
    sum(ba.credits) AS category_credits
   FROM (public.badge_awards ba
     JOIN public.badges b ON ((ba.badge_id = b.id)))
  WHERE (ba.tag_id IS NOT NULL)
  GROUP BY ba.awarded_to_user_id, ba.tag_id, b.category;


--
-- Name: v_user_tag_dominant_category; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_tag_dominant_category AS
 SELECT DISTINCT ON (user_id, tag_id) user_id,
    tag_id,
    badge_category,
    category_credits
   FROM public.v_user_tag_badge_credits
  ORDER BY user_id, tag_id, category_credits DESC, badge_category;


--
-- Name: v_user_total_badge_credits; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_total_badge_credits AS
 SELECT awarded_to_user_id AS user_id,
    (sum(credits))::integer AS total_badge_credits
   FROM public.badge_awards ba
  GROUP BY awarded_to_user_id;


--
-- Name: badge_awards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards ALTER COLUMN id SET DEFAULT nextval('public.badge_awards_id_seq'::regclass);


--
-- Name: badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges ALTER COLUMN id SET DEFAULT nextval('public.badges_id_seq'::regclass);


--
-- Name: contact_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_reports ALTER COLUMN id SET DEFAULT nextval('public.contact_reports_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: tag_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_categories ALTER COLUMN id SET DEFAULT nextval('public.tag_categories_id_seq'::regclass);


--
-- Name: tag_supercategories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_supercategories ALTER COLUMN id SET DEFAULT nextval('public.tag_supercategories_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: team_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_applications ALTER COLUMN id SET DEFAULT nextval('public.team_applications_id_seq'::regclass);


--
-- Name: team_invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invitations ALTER COLUMN id SET DEFAULT nextval('public.team_invitations_id_seq'::regclass);


--
-- Name: team_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members ALTER COLUMN id SET DEFAULT nextval('public.team_members_id_seq'::regclass);


--
-- Name: team_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tags ALTER COLUMN id SET DEFAULT nextval('public.team_tags_id_seq'::regclass);


--
-- Name: team_vacant_role_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_badges ALTER COLUMN id SET DEFAULT nextval('public.team_vacant_role_badges_id_seq'::regclass);


--
-- Name: team_vacant_role_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_tags ALTER COLUMN id SET DEFAULT nextval('public.team_vacant_role_tags_id_seq'::regclass);


--
-- Name: team_vacant_roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_roles ALTER COLUMN id SET DEFAULT nextval('public.team_vacant_roles_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: user_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges ALTER COLUMN id SET DEFAULT nextval('public.user_badges_id_seq'::regclass);


--
-- Name: user_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tags ALTER COLUMN id SET DEFAULT nextval('public.user_tags_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: badge_awards badge_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards
    ADD CONSTRAINT badge_awards_pkey PRIMARY KEY (id);


--
-- Name: badges badges_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_name_key UNIQUE (name);


--
-- Name: badges badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);


--
-- Name: contact_reports contact_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_reports
    ADD CONSTRAINT contact_reports_pkey PRIMARY KEY (id);


--
-- Name: contact_reports contact_reports_reference_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_reports
    ADD CONSTRAINT contact_reports_reference_code_key UNIQUE (reference_code);


--
-- Name: message_reads message_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reads
    ADD CONSTRAINT message_reads_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: tag_categories tag_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_categories
    ADD CONSTRAINT tag_categories_pkey PRIMARY KEY (id);


--
-- Name: tag_categories tag_categories_supercategory_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_categories
    ADD CONSTRAINT tag_categories_supercategory_id_name_key UNIQUE (supercategory_id, name);


--
-- Name: tag_category_translations tag_category_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_category_translations
    ADD CONSTRAINT tag_category_translations_pkey PRIMARY KEY (category_id, language);


--
-- Name: tag_supercategories tag_supercategories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_supercategories
    ADD CONSTRAINT tag_supercategories_name_key UNIQUE (name);


--
-- Name: tag_supercategories tag_supercategories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_supercategories
    ADD CONSTRAINT tag_supercategories_pkey PRIMARY KEY (id);


--
-- Name: tag_supercategory_translations tag_supercategory_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_supercategory_translations
    ADD CONSTRAINT tag_supercategory_translations_pkey PRIMARY KEY (supercategory_id, language);


--
-- Name: tag_translations tag_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_translations
    ADD CONSTRAINT tag_translations_pkey PRIMARY KEY (tag_id, language);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: team_applications team_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_applications
    ADD CONSTRAINT team_applications_pkey PRIMARY KEY (id);


--
-- Name: team_invitations team_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: team_tags team_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tags
    ADD CONSTRAINT team_tags_pkey PRIMARY KEY (id);


--
-- Name: team_tags team_tags_team_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tags
    ADD CONSTRAINT team_tags_team_id_tag_id_key UNIQUE (team_id, tag_id);


--
-- Name: team_vacant_role_badges team_vacant_role_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_badges
    ADD CONSTRAINT team_vacant_role_badges_pkey PRIMARY KEY (id);


--
-- Name: team_vacant_role_badges team_vacant_role_badges_role_id_badge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_badges
    ADD CONSTRAINT team_vacant_role_badges_role_id_badge_id_key UNIQUE (role_id, badge_id);


--
-- Name: team_vacant_role_tags team_vacant_role_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_tags
    ADD CONSTRAINT team_vacant_role_tags_pkey PRIMARY KEY (id);


--
-- Name: team_vacant_role_tags team_vacant_role_tags_role_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_tags
    ADD CONSTRAINT team_vacant_role_tags_role_id_tag_id_key UNIQUE (role_id, tag_id);


--
-- Name: team_vacant_roles team_vacant_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_roles
    ADD CONSTRAINT team_vacant_roles_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_badges user_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (id);


--
-- Name: user_badges user_badges_user_id_badge_id_awarded_by_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_badge_id_awarded_by_key UNIQUE (user_id, badge_id, awarded_by);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: user_tags user_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tags
    ADD CONSTRAINT user_tags_pkey PRIMARY KEY (id);


--
-- Name: user_tags user_tags_user_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tags
    ADD CONSTRAINT user_tags_user_id_tag_id_key UNIQUE (user_id, tag_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_badge_awards_badge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_awards_badge ON public.badge_awards USING btree (badge_id);


--
-- Name: idx_badge_awards_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_awards_team ON public.badge_awards USING btree (team_id);


--
-- Name: idx_badge_awards_to_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_awards_to_user ON public.badge_awards USING btree (awarded_to_user_id);


--
-- Name: idx_badge_awards_to_user_badge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_badge_awards_to_user_badge ON public.badge_awards USING btree (awarded_to_user_id, badge_id);


--
-- Name: idx_contact_reports_reporter_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_reports_reporter_email ON public.contact_reports USING btree (lower(reporter_email));


--
-- Name: idx_contact_reports_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_reports_status_created_at ON public.contact_reports USING btree (status, created_at DESC);


--
-- Name: idx_message_reads_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reads_message_id ON public.message_reads USING btree (message_id);


--
-- Name: idx_message_reads_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reads_user_id ON public.message_reads USING btree (user_id);


--
-- Name: idx_messages_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_deleted_at ON public.messages USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_messages_file_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_file_expires_at ON public.messages USING btree (file_expires_at) WHERE ((file_expires_at IS NOT NULL) AND (file_deleted_at IS NULL));


--
-- Name: idx_messages_file_expiring_soon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_file_expiring_soon ON public.messages USING btree (file_expires_at) WHERE ((file_expires_at IS NOT NULL) AND (file_deleted_at IS NULL));


--
-- Name: idx_messages_receiver_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_receiver_unread ON public.messages USING btree (receiver_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_messages_reply_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_reply_to_id ON public.messages USING btree (reply_to_id);


--
-- Name: idx_messages_sender_receiver_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender_receiver_sent ON public.messages USING btree (sender_id, receiver_id, sent_at DESC) WHERE (team_id IS NULL);


--
-- Name: idx_messages_team_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_team_sent ON public.messages USING btree (team_id, sent_at DESC) WHERE (team_id IS NOT NULL);


--
-- Name: idx_messages_team_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_team_unread ON public.messages USING btree (team_id, sender_id, read_at) WHERE ((read_at IS NULL) AND (team_id IS NOT NULL));


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_team_applications_applicant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_applications_applicant ON public.team_applications USING btree (applicant_id);


--
-- Name: idx_team_applications_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_applications_role_id ON public.team_applications USING btree (role_id);


--
-- Name: idx_team_applications_team_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_applications_team_status ON public.team_applications USING btree (team_id, status);


--
-- Name: idx_team_invitations_invitee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invitations_invitee_id ON public.team_invitations USING btree (invitee_id);


--
-- Name: idx_team_invitations_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invitations_role_id ON public.team_invitations USING btree (role_id);


--
-- Name: idx_team_invitations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invitations_status ON public.team_invitations USING btree (status);


--
-- Name: idx_team_invitations_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invitations_team_id ON public.team_invitations USING btree (team_id);


--
-- Name: idx_team_vacant_roles_is_synthetic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_vacant_roles_is_synthetic ON public.team_vacant_roles USING btree (is_synthetic);


--
-- Name: idx_teams_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_city ON public.teams USING btree (city);


--
-- Name: idx_teams_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_country ON public.teams USING btree (country);


--
-- Name: idx_teams_is_remote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_is_remote ON public.teams USING btree (is_remote);


--
-- Name: idx_teams_is_synthetic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_is_synthetic ON public.teams USING btree (is_synthetic);


--
-- Name: idx_ubwct_user_badge; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ubwct_user_badge ON public.v_user_badges_with_category_totals USING btree (user_id, badge_id);


--
-- Name: idx_user_blocks_blocked_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocks_blocked_id ON public.user_blocks USING btree (blocked_id);


--
-- Name: idx_users_is_synthetic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_synthetic ON public.users USING btree (is_synthetic);


--
-- Name: idx_vacant_role_badges_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vacant_role_badges_role_id ON public.team_vacant_role_badges USING btree (role_id);


--
-- Name: idx_vacant_role_tags_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vacant_role_tags_role_id ON public.team_vacant_role_tags USING btree (role_id);


--
-- Name: idx_vacant_roles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vacant_roles_status ON public.team_vacant_roles USING btree (status);


--
-- Name: idx_vacant_roles_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vacant_roles_team_id ON public.team_vacant_roles USING btree (team_id);


--
-- Name: idx_vacant_roles_team_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vacant_roles_team_status ON public.team_vacant_roles USING btree (team_id, status);


--
-- Name: team_applications_unique_pending_general; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_applications_unique_pending_general ON public.team_applications USING btree (team_id, applicant_id) WHERE (((status)::text = 'pending'::text) AND (role_id IS NULL));


--
-- Name: team_applications_unique_pending_role; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_applications_unique_pending_role ON public.team_applications USING btree (team_id, applicant_id, role_id) WHERE (((status)::text = 'pending'::text) AND (role_id IS NOT NULL));


--
-- Name: team_invitations_unique_general_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_invitations_unique_general_pending ON public.team_invitations USING btree (team_id, invitee_id) WHERE ((role_id IS NULL) AND ((status)::text = 'pending'::text));


--
-- Name: team_invitations_unique_role_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_invitations_unique_role_pending ON public.team_invitations USING btree (team_id, invitee_id, role_id) WHERE ((role_id IS NOT NULL) AND ((status)::text = 'pending'::text));


--
-- Name: users_email_change_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_email_change_token_idx ON public.users USING btree (email_change_token) WHERE (email_change_token IS NOT NULL);


--
-- Name: users_email_unique_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_unique_ci ON public.users USING btree (lower((email)::text));


--
-- Name: users_pending_email_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_pending_email_lower_idx ON public.users USING btree (lower(pending_email)) WHERE (pending_email IS NOT NULL);


--
-- Name: users_username_unique_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_username_unique_ci ON public.users USING btree (lower((username)::text));


--
-- Name: badge_awards badge_awards_awarded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards
    ADD CONSTRAINT badge_awards_awarded_by_user_id_fkey FOREIGN KEY (awarded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: badge_awards badge_awards_awarded_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards
    ADD CONSTRAINT badge_awards_awarded_to_user_id_fkey FOREIGN KEY (awarded_to_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: badge_awards badge_awards_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards
    ADD CONSTRAINT badge_awards_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id) ON DELETE CASCADE;


--
-- Name: badge_awards badge_awards_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards
    ADD CONSTRAINT badge_awards_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id);


--
-- Name: badge_awards badge_awards_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badge_awards
    ADD CONSTRAINT badge_awards_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: message_reads message_reads_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reads
    ADD CONSTRAINT message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_reads message_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reads
    ADD CONSTRAINT message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_receiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tag_categories tag_categories_supercategory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_categories
    ADD CONSTRAINT tag_categories_supercategory_id_fkey FOREIGN KEY (supercategory_id) REFERENCES public.tag_supercategories(id);


--
-- Name: tag_category_translations tag_category_translations_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_category_translations
    ADD CONSTRAINT tag_category_translations_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.tag_categories(id) ON DELETE CASCADE;


--
-- Name: tag_supercategory_translations tag_supercategory_translations_supercategory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_supercategory_translations
    ADD CONSTRAINT tag_supercategory_translations_supercategory_id_fkey FOREIGN KEY (supercategory_id) REFERENCES public.tag_supercategories(id) ON DELETE CASCADE;


--
-- Name: tag_translations tag_translations_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_translations
    ADD CONSTRAINT tag_translations_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: tags tags_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.tag_categories(id);


--
-- Name: tags tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: tags tags_supercategory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_supercategory_id_fkey FOREIGN KEY (supercategory_id) REFERENCES public.tag_supercategories(id);


--
-- Name: team_applications team_applications_applicant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_applications
    ADD CONSTRAINT team_applications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_applications team_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_applications
    ADD CONSTRAINT team_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: team_applications team_applications_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_applications
    ADD CONSTRAINT team_applications_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.team_vacant_roles(id) ON DELETE SET NULL;


--
-- Name: team_applications team_applications_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_applications
    ADD CONSTRAINT team_applications_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_invitations team_invitations_invitee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_invitations team_invitations_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_invitations team_invitations_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.team_vacant_roles(id) ON DELETE SET NULL;


--
-- Name: team_invitations team_invitations_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_tags team_tags_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tags
    ADD CONSTRAINT team_tags_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_vacant_role_badges team_vacant_role_badges_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_badges
    ADD CONSTRAINT team_vacant_role_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id) ON DELETE CASCADE;


--
-- Name: team_vacant_role_badges team_vacant_role_badges_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_badges
    ADD CONSTRAINT team_vacant_role_badges_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.team_vacant_roles(id) ON DELETE CASCADE;


--
-- Name: team_vacant_role_tags team_vacant_role_tags_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_tags
    ADD CONSTRAINT team_vacant_role_tags_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.team_vacant_roles(id) ON DELETE CASCADE;


--
-- Name: team_vacant_role_tags team_vacant_role_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_role_tags
    ADD CONSTRAINT team_vacant_role_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: team_vacant_roles team_vacant_roles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_roles
    ADD CONSTRAINT team_vacant_roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: team_vacant_roles team_vacant_roles_filled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_roles
    ADD CONSTRAINT team_vacant_roles_filled_by_fkey FOREIGN KEY (filled_by) REFERENCES public.users(id);


--
-- Name: team_vacant_roles team_vacant_roles_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_vacant_roles
    ADD CONSTRAINT team_vacant_roles_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: teams teams_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_creator_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: user_badges user_badges_awarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_awarded_by_fkey FOREIGN KEY (awarded_by) REFERENCES public.users(id);


--
-- Name: user_badges user_badges_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: user_badges user_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_tags user_tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tags
    ADD CONSTRAINT user_tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


