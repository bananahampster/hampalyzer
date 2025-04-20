EVENT table (table is new)

| name            | type     | values  | notes                        |
|-----------------|----------|---------|------------------------------|
| eventId         |          |         | auto-increment, NOT NULL     |
| roundId         |          |         | round table id ref, NOT NULL |
| eventType       | enum     | 0-71    | NOT NULL                     |
| lineNumber      | number   |         | NOT NULL                     |
| timestamp       | datetime |         | NOT NULL                     |
| gameTime        | number   | seconds | NOT NULL                     |
| extraData       | string   |         | (prefer json format?)        |
| playerFrom      |          |         | player table id ref          |
| playerFromClass | short    | 0-9     |                              |
| playerTo        |          |         | player table id ref          |
| playerToClass   | short    | 0-9     |                              |
| withWeapon      | short    | 0-39    |                              |
| playerFromFlag  | bool     |         | default false                |
| playerToFlag    | bool     |         | default false                |

CREATE TABLE event (
  id serial,
  roundId integer NOT NULL,
  eventType smallint NOT NULL,
  lineNumber smallint NOT NULL,
  timestamp timestamp without time zone NOT NULL,
  gameTime smallint NOT NULL,
  extraData character varying(512),
  playerFrom integer,
  playerFromClass smallint,
  playerTo integer,
  playerToClass smallint,
  withWeapon smallint,
  playerFromFlag boolean DEFAULT false,
  playerToFlag boolean DEFAULT false,
  PRIMARY KEY(id),
  CONSTRAINT fk_round
    FOREIGN KEY(roundId)
      REFERENCES round(id)
      ON DELETE NO ACTION,
  CONSTRAINT fk_playerFrom
    FOREIGN KEY(playerFrom)
      REFERENCES player(id)
      ON DELETE NO ACTION,
  CONSTRAINT fk_playerTo
    FOREIGN KEY(playerTo)
      REFERENCES player(id)
      ON DELETE NO ACTION
);

CREATE INDEX idx_event_roundid on event (roundId);
CREATE INDEX idx_event_playerfrom on event(playerFrom);
CREATE INDEX idx_event_playerto on event(playerTo);
CREATE INDEX idx_event_eventtype on event(eventType);


ROUND table (table is new)

| name            | type     | desc    | notes                      |
|-----------------|----------|---------|----------------------------|
| id              |          |         | auto-increment, NOT NULL   |
| logId           | number   |         | logs table id ref          |
| isFirst         | boolean  |         | default TRUE               |

CREATE TABLE round (
  id serial,
  logId integer NOT NULL,
  isFirst boolean NOT NULL DEFAULT TRUE,
  PRIMARY KEY(id),
  CONSTRAINT fk_log
    FOREIGN KEY(logId)
      REFERENCES logs(id)
      ON DELETE NO ACTION
);

CREATE INDEX idx_round_logid on round(logid);


PLAYER table (table is new)

| name            | type     | desc    | notes                      |
|-----------------|----------|---------|----------------------------|
| id              |          |         | auto-increment, NOT NULL   |
| name            | string   |         | NOT NULL                   |
| alias           | string   |         |                            |
| steamId         | number   |         | see [SteamID doc](https://developer.valvesoftware.com/wiki/SteamID) |

CREATE TABLE player (
  id serial,
  name character varying(32),
  alias character varying(32),
  steamId character varying(32),
  PRIMARY KEY(id)
);

MATCH table (table is new)

| name            | type     | desc    | notes                      |
|-----------------|----------|---------|----------------------------|
| roundId         | int      |         | round table id ref         |
| playerId        | int      |         | player table id ref        |
| team            | smallint | 0-4     | NOT NULL (players are 1-2) |

CREATE TABLE match (
  roundId integer NOT NULL,
  playerId integer NOT NULL,
  team smallint NOT NULL,
  CONSTRAINT fk_round
    FOREIGN KEY(roundId)
      REFERENCES round(id)
      ON DELETE NO ACTION,
  CONSTRAINT fk_player
    FOREIGN KEY(playerId)
      REFERENCES player(id)
      ON DELETE NO ACTION
);

CREATE INDEX idx_match_roundid ON match (roundId);
CREATE INDEX idx_match_playerid ON match (playerId);


LOGS table (* are new columns)

| name            | type     | values   | notes                      |
|-----------------|----------|----------|----------------------------|
| id              |          |          | auto-increment, NOT NULL   |
| parsedlog       | string   |          | output URI slug            |
| log_file1       | string   |          | matches name in uploads/   |
| log_file2       | string   |          | matches name in uploads/   |
| date_parsed     | datetime |          | initial upload time        |
| date_match      | datetime |          | reported in local time     |
| map             | string   |          | can be "<multiple>"        |
| server          | string   |          |                            |
| num_players     | int      |          |                            |
| * is_valid      | bool     |          | default false              |
| * score_team1   | smallint |          | default 0                  |
| * score_team2   | smallint |          | default 0                  |

alter table logs add column "is_valid" boolean not null default true;
alter table logs add column "score_team1" integer default 0;
alter table logs add column "score_team2" integer default 0;

CREATE TABLE logs (
    id integer NOT NULL,
    parsedlog character varying(255) NOT NULL,
    log_file1 character varying(255) NOT NULL,
    log_file2 character varying(255),
    date_parsed timestamp without time zone NOT NULL,
    date_match timestamp without time zone NOT NULL,
    map character varying(50),
    server character varying(255),
    num_players smallint
    is_valid boolean NOT NULL DEFAULT TRUE,
    score_team1 integer DEFAULT 0,
    score_team2 integer DEFAULT 0,
);


PARSEDGAMES table (table is new)

| name            | type         | values   | notes                      |
|-----------------|--------------|----------|----------------------------|
| logId           |              |          | logs table id ref, PRIMARY |
| summary         | json         |          | full json                  |

CREATE TABLE parsedgames (
  logId integer NOT NULL,
  summary jsonb NOT NULL,
  CONSTRAINT fk_log
    FOREIGN KEY(logId)
      REFERENCES logs(id)
      ON DELETE NO ACTION
);
CREATE INDEX idx_parsedgames_logid ON parsedgames(logId);

PARSEDGAMEPLAYERS table (table is new)

| name            | type         | values   | notes                      |
|-----------------|--------------|----------|----------------------------|
| logId           |              |          | logs table id ref          |
| playerId        |              |          | player table id ref        |
| summary         | json         |          | full json                  |


CREATE TABLE parsedgameplayers (
  logId integer NOT NULL,
  playerId integer NOT NULL,
  summary jsonb NOT NULL,
  CONSTRAINT fk_log
    FOREIGN KEY(logId)
      REFERENCES logs(id)
      ON DELETE NO ACTION,
  CONSTRAINT fk_player
    FOREIGN KEY(playerId)
      REFERENCES player(id)
      ON DELETE NO ACTION
);

CREATE INDEX idx_parsedgameplayers_logid ON parsedgameplayers(logId);
CREATE INDEX idx_parsedgameplayers_playerid ON parsedgameplayers(playerId);


MAPLOCATIONS table (table is new)

| name            | type         | values   | notes                      |
|-----------------|--------------|----------|----------------------------|
| locationId      |              |          | auto-increment, NOT NULL   |
| map             | string       |          | NOT NULL, add index        |
| name            | string       |          | user-provided name/callout |
| geom            | geometry     |          | will be POLYGON Z, typ.    |

SELECT name
  FROM mapLocations
WHERE ST_3DIntersects(
    geom,
    'POINT Z($x, $y, $z)'::geometry
)
LIMIT 1;

ALTER TABLE logs 

# get column sizes in a table filled with data
https://dbfiddle.uk/wtnwh8v7
select *, pg_size_pretty(column_size) from column_sizes('event');
