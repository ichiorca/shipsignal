package shared

// #SemVer constrains a semver 2.0.0 string. Build/prerelease accepted.
#SemVer: =~"^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$"

// #SemVerConstraint accepts npm-style ranges (^1.2.3, ~1.2, >=1.0 <2).
#SemVerConstraint: string
