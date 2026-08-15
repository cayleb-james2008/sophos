// AboutPanel — the Settings "About" tab. Shows the app name, the current
// version read from package.json, a Beta badge, a short description, and
// links to the GitLab repo and CHANGELOG.

import { Card, Text, Badge } from "../../design";
import { version } from "../../../package.json";

export function AboutPanel() {
  return (
    <Card variant="raised" padding="lg">
      <div className="about-panel">
        <div className="about-panel__header">
          <Text variant="label" weight="semibold">
            Sophos
          </Text>
          <div className="about-panel__version-row">
            <span className="about-panel__version">v{version}</span>
            <Badge tone="warning" dot>
              Beta
            </Badge>
          </div>
        </div>
        <Text variant="body" tone="dim">
          A Windows-native coding agent. All versions before v1.0 are beta releases.
        </Text>
        <div className="about-panel__links">
          <a
            href="https://gitlab.com/caylebalvarez-james/sophos"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitLab
          </a>
          <span> · </span>
          <a
            href="https://gitlab.com/caylebalvarez-james/sophos/-/blob/master/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Changelog
          </a>
        </div>
      </div>
    </Card>
  );
}
