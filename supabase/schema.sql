-- GridSync persistent schema.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- api/handler.js talks to these tables over the PostgREST /rest/v1 API using
-- SUPABASE_URL/SUPABASE_KEY. Use the project's `service_role` key for
-- SUPABASE_KEY (Project Settings -> API) since the server writes on behalf of
-- all users (auth, reports, admin overrides) - the anon key would need RLS
-- policies opened up for every one of these tables to work the same way.
-- Never ship the service_role key to the browser; it only belongs in Vercel's
-- server-side environment variables / .env.local.

create table if not exists users (
    email               text primary key,
    password_hash       text not null,
    role                text not null default 'User',
    name                text not null,
    phone               text default '',
    vehicle_model       text default '',
    vehicle_no          text default '',
    battery_capacity    numeric default 0,
    max_range           numeric default 0,
    preferred_connector text default '',
    min_reserve         numeric default 15,
    preferred_speed     text default 'DC',
    saved_stations      jsonb not null default '[]',
    charging_history    jsonb not null default '[]',
    created_at          timestamptz not null default now()
);

create table if not exists saved_trips (
    id         text primary key,
    created_at timestamptz not null default now(),
    data       jsonb not null
);

create table if not exists reports (
    id         bigserial primary key,
    station_id text not null,
    working    boolean not null,
    user_email text default 'anonymous',
    created_at timestamptz not null default now()
);
create index if not exists reports_station_id_idx on reports (station_id);

create table if not exists station_overrides (
    station_id text primary key,
    title      text,
    operator   text,
    address    text,
    latitude   double precision,
    longitude  double precision,
    hours      text,
    contact    text,
    updated_at timestamptz not null default now()
);

create table if not exists charger_overrides (
    station_id text not null,
    charger_id text not null,
    status     text not null,
    updated_at timestamptz not null default now(),
    primary key (station_id, charger_id)
);

-- Impact / sustainability analytics. One row per tracked user action
-- (session_start, route_planned, charger_diverted). Powers the admin
-- "traffic diverted through GridSync" dashboard and each driver's personal
-- impact card on the Profile tab. See api/handler.js for the event types
-- and the derived kWh/CO2/revenue estimates.
create table if not exists analytics_events (
    id          bigserial primary key,
    event_type  text not null,
    user_email  text default 'anonymous',
    station_id  text,
    metadata    jsonb not null default '{}',
    created_at  timestamptz not null default now()
);
create index if not exists analytics_events_type_idx on analytics_events (event_type);
create index if not exists analytics_events_created_idx on analytics_events (created_at desc);
create index if not exists analytics_events_user_idx on analytics_events (user_email);

-- These tables are only ever reached through the trusted server proxy
-- (service_role key), never directly from the browser, so RLS stays off.
alter table users              disable row level security;
alter table saved_trips        disable row level security;
alter table reports            disable row level security;
alter table station_overrides  disable row level security;
alter table charger_overrides  disable row level security;
alter table analytics_events   disable row level security;
