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


PLAYER table (table is new)

| name            | type     | desc    | notes                      |
|-----------------|----------|---------|----------------------------|
| playerId        |          |         | auto-increment, NOT NULL   |
| playerName      | string   |         | NOT NULL                   |
| playerAlias     | string   |         |                            |
| steamId         | number   |         | see [SteamID doc](https://developer.valvesoftware.com/wiki/SteamID) |


LOGS table (* are new columns)

| name            | type     | values   | notes                      |
|-----------------|----------|----------|----------------------------|
| * logId         |          |          | auto-increment, NOT NULL   |
| parsedlog       | string   |          | output URI slug            |
| log_file1       | string   |          | matches name in uploads/   |
| log_file2       | string   |          | matches name in uploads/   |
| date_parsed     | datetime |          | initial upload time        |
| date_match      | datetime |          | reported in local time     |
| map             | string   |          | can be "<multiple>"        |
| server          | string   |          |                            |
| num_players     | int      |          |                            |
| * is_valid      | bool     |          | default false              |


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