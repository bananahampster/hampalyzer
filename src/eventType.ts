
// TODO: check `logs\L1125012.log` for others (like pills, caltrop, etc.)
export enum EventType {
    StartLog, /* done */
    MapLoading, /* done */
    ServerCvarStart, /* done */
    ServerCvar, /* done */
    ServerCvarEnd, /* done */
    ServerName, /* done */
    MapLoaded, /* done */
    PlayerJoinTeam, /* done */
    PlayerJoinServer, /* done */
    PlayerChangeRole, /* done */
    PlayerCommitSuicide, /* done */
    PlayerMM1, /* done */
    PlayerMM2, /* done */
    RconCommand, /* done */
    ServerSay,
    WorldTrigger,
    PrematchEnd, /* done */
    PlayerSpawn, /* done */
    PlayerConced, /* done */
    PlayerCaltroppedPlayer, /* done */
    PlayerFraggedPlayer, /* done */
    PlayerFraggedGun, /* done */
    PlayerFraggedDispenser, /* done */
    PlayerFraggedTeleporter, /* done */
    PlayerHitAirshot, /* done, not verified */
    PlayerTranqedPlayer, /* done */
    PlayerHallucinatedPlayer, /* done */
    PlayerInfectedPlayer, /* done */
    PlayerPassedInfection, /* done */
    PlayerDetpackSet, /* done, not verified */
    PlayerDetpackExplode, /* done, not verified */
    PlayerDetpackDisarm, /* done, not verified */
    PlayerUpgradedGun, /* done */
    PlayerUpgradedOtherGun, /* done, not verified */
    PlayerBuiltSentryGun, /* done */
    PlayerBuiltDispenser, /* done */
    PlayerBuiltTeleporter, /* done, not verified */
    PlayerRepairedBuilding, /* done */
    PlayerDetonatedBuilding, /* done (no teleporter) */
    PlayerDismantledBuilding, /* done (only sentrygun) */
    PlayerPickedUpFlag, /* TODO: will be very map-specific */
    PlayerThrewFlag,
    PlayerCapturedFlag, /* TODO: will be very map-specific */
    PlayerGotSecurity, /* TODO: will be very map-specific */
    PlayerOpenedDetpackEntrance, /* TODO: will be very map-specific */
    PlayerHeal, /* done */
    FlagReturn, /* done, not verified */
    SecurityUp, /* done */
    TeamScore, /* done */
    MetaModMessages,
    EndLog, /* done */
};

export default EventType;