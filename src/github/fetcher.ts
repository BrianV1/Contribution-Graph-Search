/**
 * GitHub contribution fetcher.
 *
 * Pulls the last year of a user's contribution calendar via the GitHub GraphQL
 * API and returns it in the weeks/days shape that {@link gridFromCalendar}
 * consumes. Also provides a deterministic synthetic generator so the whole
 * pipeline can run offline (`--demo`) with no token or network.
 */

export interface CalendarWeek {
  contributionDays: {
    contributionLevel: string;
    date: string;
    contributionCount: number;
  }[];
}

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            contributionCount
            date
            contributionLevel
          }
        }
      }
    }
  }
}`;

/**
 * Fetch a user's contribution calendar. Requires a token with `read:user` in
 * `GITHUB_TOKEN` (the default token available inside GitHub Actions works).
 */
export async function fetchContributions(
  username: string,
  token: string,
): Promise<CalendarWeek[]> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'contribution-graph-search',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    errors?: { message: string }[];
    data?: {
      user?: {
        contributionsCollection?: {
          contributionCalendar?: { weeks?: CalendarWeek[] };
        };
      };
    };
  };

  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  const weeks = json.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error(`No contribution data for user "${username}".`);
  return weeks;
}

/**
 * Generate a plausible synthetic calendar (53 weeks) for offline development.
 * Deterministic given `seed` so demo output is stable.
 */
export function demoContributions(seed = 7): CalendarWeek[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
  const weeks: CalendarWeek[] = [];
  const start = new Date(Date.UTC(2025, 6, 13)); // a Sunday

  for (let w = 0; w < 53; w++) {
    const days: CalendarWeek['contributionDays'] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + w * 7 + d);
      // Clustered activity: streaky weekdays, quieter weekends, plenty of gaps
      // so the free space stays well-connected (like a real, sparse calendar).
      const weekdayBias = d === 0 || d === 6 ? 0.14 : 0.4;
      const streak = Math.sin(w * 0.45) * 0.18 + 0.42;
      const r = rand();
      let level = 0;
      if (r < weekdayBias * streak) {
        level = 1 + Math.floor(rand() * 4);
      }
      days.push({
        contributionLevel: levels[level]!,
        date: date.toISOString().slice(0, 10),
        contributionCount: level === 0 ? 0 : level * (1 + Math.floor(rand() * 6)),
      });
    }
    weeks.push({ contributionDays: days });
  }
  return weeks;
}
