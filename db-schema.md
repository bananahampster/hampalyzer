EVENT table (table is new)

| name            | type     | values  | notes                      |
|-----------------|----------|---------|----------------------------|
| eventId         |          |         | auto-increment, NOT NULL   |
| logId           |          |         | log table id ref, NOT NULL |
| isFirstLog      | bool     |         | default true               |
| eventType       | enum     | 0-71    | NOT NULL                   |
| rawLine         | string   |         | NOT NULL                   |
| lineNumber      | number   |         | NOT NULL                   |
| timestamp       | datetime |         | NOT NULL                   |
| gameTime        | number   | seconds | NOT NULL                   |
| extraData       | string   |         | (prefer json format?)      |
| playerFrom      |          |         | player table id ref        |
| playerFromClass | short    | 0-9     |                            |
| playerTo        |          |         | player table id ref        |
| playerToClass   | short    | 0-9     |                            |
| withWeapon      | short    | 0-39    |                            |
| playerFromFlag  | bool     |         | default false              |
| playerToFlag    | bool     |         | default false              |

CREATE TABLE event (
  id serial,
  logId integer NOT NULL,
  isFirstLog boolean NOT NULL DEFAULT TRUE,
  eventType smallint NOT NULL,
  rawLine character varying(1024),
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
  CONSTRAINT fk_log
    FOREIGN KEY(logId)
      REFERENCES logs(id)
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
  steamId integer,
  PRIMARY KEY(id)
);

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

alter table logs add column "is_valid" boolean not null deafult true;

PARSEDLOGS table (table is new)

| name            | type         | values   | notes                      |
|-----------------|--------------|----------|----------------------------|
| logId           |              |          | auto-increment, NOT NULL   |
| jsonSummary     | varchar(MAX) |          | full json                  |


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