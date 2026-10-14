create table if not exists users (
  id serial primary key,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists links (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  code text unique not null,
  original_url text not null,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists clicks (
  id bigserial primary key,
  link_id int not null references links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  referrer text, country text, device_type text, browser text, os text,
  visitor_hash text
);
create index if not exists clicks_link_time on clicks(link_id, clicked_at);
create index if not exists links_user on links(user_id);
