async function fetchContributions(username, token, from, to) {
  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { username, from: from.toISOString(), to: to.toISOString() },
    }),
  });

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);

  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  return weeks.flatMap((w) => w.contributionDays);
}

function calculateStats(days) {
  days.sort((a, b) => a.date.localeCompare(b.date));

  const totalContributions = days.reduce((sum, d) => sum + d.contributionCount, 0);
  const today = new Date().toISOString().split('T')[0];

  let todayIdx = days.findIndex((d) => d.date === today);
  if (todayIdx === -1) todayIdx = days.length - 1;

  let i = todayIdx;
  if (days[i] && days[i].contributionCount === 0) i--;

  let currentStreak = 0;
  let currentStreakStart = null;
  while (i >= 0 && days[i].contributionCount > 0) {
    currentStreak++;
    currentStreakStart = days[i].date;
    i--;
  }

  let longestStreak = 0;
  let longestStreakStart = null;
  let longestStreakEnd = null;
  let run = 0;
  let runStart = null;

  for (const day of days) {
    if (day.contributionCount > 0) {
      if (run === 0) runStart = day.date;
      run++;
      if (run > longestStreak) {
        longestStreak = run;
        longestStreakStart = runStart;
        longestStreakEnd = day.date;
      }
    } else {
      run = 0;
      runStart = null;
    }
  }

  return { currentStreak, longestStreak, totalContributions, currentStreakStart, longestStreakStart, longestStreakEnd };
}

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}

function generateSVG({ currentStreak, longestStreak, totalContributions, currentStreakStart, longestStreakStart, longestStreakEnd }) {
  const bg = '#0D1117';
  const primary = '#7aa2f7';
  const accent = '#bb9af7';
  const muted = '#565f89';

  const currentLabel = currentStreakStart ? `${fmt(currentStreakStart)} – Present` : 'No streak yet';
  const longestLabel = longestStreakStart ? `${fmt(longestStreakStart)} – ${fmt(longestStreakEnd)}` : 'No streak yet';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195">
  <style>
    text { font-family: 'Segoe UI', Ubuntu, Sans-Serif; }
  </style>
  <rect width="495" height="195" rx="10" fill="${bg}"/>
  <line x1="165" y1="28" x2="165" y2="167" stroke="${muted}" stroke-width="1" stroke-opacity="0.4"/>
  <line x1="330" y1="28" x2="330" y2="167" stroke="${muted}" stroke-width="1" stroke-opacity="0.4"/>

  <!-- Total Contributions -->
  <text x="83" y="62" text-anchor="middle" font-size="12" fill="${muted}">Total Contributions</text>
  <text x="83" y="106" text-anchor="middle" font-size="32" font-weight="700" fill="${primary}">${totalContributions}</text>
  <text x="83" y="130" text-anchor="middle" font-size="11" fill="${muted}">Lifetime</text>

  <!-- Current Streak -->
  <text x="248" y="56" text-anchor="middle" font-size="13" fill="${muted}">Current Streak</text>
  <circle cx="248" cy="108" r="40" fill="none" stroke="${accent}" stroke-width="2.5"/>
  <text x="248" y="116" text-anchor="middle" font-size="32" font-weight="700" fill="${accent}">${currentStreak}</text>
  <text x="248" y="158" text-anchor="middle" font-size="11" fill="${muted}">${currentLabel}</text>

  <!-- Longest Streak -->
  <text x="413" y="62" text-anchor="middle" font-size="12" fill="${muted}">Longest Streak</text>
  <text x="413" y="106" text-anchor="middle" font-size="32" font-weight="700" fill="${primary}">${longestStreak}</text>
  <text x="413" y="126" text-anchor="middle" font-size="11" fill="${muted}">${fmt(longestStreakStart)}</text>
  <text x="413" y="140" text-anchor="middle" font-size="11" fill="${muted}">${longestStreakEnd ? '– ' + fmt(longestStreakEnd) : ''}</text>
</svg>`;
}

module.exports = async function handler(req, res) {
  const username = req.query.user;
  if (!username) return res.status(400).send('Missing ?user= parameter');

  const token = process.env.TOKEN;
  if (!token) return res.status(500).send('TOKEN env var not set');

  try {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const [recent, older] = await Promise.all([
      fetchContributions(username, token, oneYearAgo, now),
      fetchContributions(username, token, twoYearsAgo, oneYearAgo),
    ]);

    const stats = calculateStats([...older, ...recent]);
    const svg = generateSVG(stats);

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).send(svg);
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  }
};
