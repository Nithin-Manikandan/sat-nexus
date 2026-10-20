/* ============================================================
   SAT NEXUS — Content Data Layer
   College Board–aligned Digital SAT questions (DSAT format)
   ============================================================ */

/* ── Practice Questions ─────────────────────────────────────────
   Aligned to Digital SAT domains:
   Math: Algebra | Advanced Math | Problem Solving & Data Analysis | Geometry & Trig
   R&W:  Information & Ideas | Craft & Structure | Expression of Ideas | Standard English Conventions
   ─────────────────────────────────────────────────────────────── */
const SAT_QUESTIONS = []; // Cleared — re-import from the new College Board PDFs (see scripts/ when added)

/* ── Formula Data ───────────────────────────────────────────── */
const SAT_FORMULAS = {
  'Algebra': [
    { name: 'Slope Formula', expr: 'm = (y₂ − y₁) / (x₂ − x₁)', note: 'Rise over run between any two points on a line' },
    { name: 'Slope-Intercept Form', expr: 'y = mx + b', note: 'm = slope, b = y-intercept (where line crosses y-axis)' },
    { name: 'Standard Form (Linear)', expr: 'Ax + By = C', note: 'A, B, C are integers; good for finding intercepts quickly' },
    { name: 'Point-Slope Form', expr: 'y − y₁ = m(x − x₁)', note: 'Use when you know slope m and one point (x₁, y₁)' },
    { name: 'Quadratic Formula', expr: 'x = (−b ± √(b²−4ac)) / 2a', note: 'Solves ax² + bx + c = 0 for any quadratic' },
    { name: 'Discriminant', expr: 'D = b² − 4ac', note: 'D > 0: two real roots; D = 0: one real root; D < 0: no real roots' },
    { name: 'Vertex of a Parabola', expr: 'x = −b / 2a', note: 'x-coordinate of vertex (min or max) of f(x) = ax² + bx + c' },
    { name: 'Vertex Form', expr: 'f(x) = a(x − h)² + k', note: 'Vertex at (h, k); a > 0 opens up, a < 0 opens down' }
  ],
  'Geometry (Given on Test)': [
    { name: 'Area of Triangle', expr: 'A = ½bh', note: 'b = base, h = perpendicular height to that base' },
    { name: 'Area of Circle', expr: 'A = πr²', note: 'r = radius' },
    { name: 'Circumference of Circle', expr: 'C = 2πr = πd', note: 'd = diameter = 2r' },
    { name: 'Area of Rectangle', expr: 'A = lw', note: 'l = length, w = width' },
    { name: 'Volume of Rectangular Prism', expr: 'V = lwh', note: 'Length × width × height' },
    { name: 'Volume of Cylinder', expr: 'V = πr²h', note: 'r = radius of base, h = height' },
    { name: 'Volume of Cone', expr: 'V = ⅓πr²h', note: 'One-third the volume of a cylinder with same base and height' },
    { name: 'Volume of Sphere', expr: 'V = (4/3)πr³', note: 'r = radius' },
    { name: 'Pythagorean Theorem', expr: 'a² + b² = c²', note: 'c = hypotenuse; a, b = legs of a right triangle' }
  ],
  'Geometry (Must Memorize)': [
    { name: 'Distance Formula', expr: 'd = √((x₂−x₁)² + (y₂−y₁)²)', note: 'Distance between two points in the coordinate plane' },
    { name: 'Midpoint Formula', expr: 'M = ((x₁+x₂)/2 , (y₁+y₂)/2)', note: 'Midpoint of segment between two points' },
    { name: 'Circle (Standard Form)', expr: '(x−h)² + (y−k)² = r²', note: 'Center at (h, k), radius r' },
    { name: 'Arc Length', expr: 'L = (θ/360°) × 2πr', note: 'θ = central angle in degrees' },
    { name: 'Area of Sector', expr: 'A = (θ/360°) × πr²', note: 'θ = central angle in degrees' }
  ],
  'Special Triangles': [
    { name: '30-60-90 Triangle', expr: 'Sides: x : x√3 : 2x', note: 'Short leg : long leg : hypotenuse. Memorize this ratio.' },
    { name: '45-45-90 Triangle', expr: 'Sides: x : x : x√2', note: 'Both legs equal; hypotenuse = leg × √2' },
    { name: '3-4-5 Right Triangle', expr: 'Sides: 3, 4, 5 (or multiples)', note: 'Common Pythagorean triple: 6-8-10, 9-12-15, etc.' },
    { name: '5-12-13 Right Triangle', expr: 'Sides: 5, 12, 13', note: 'Another common Pythagorean triple to recognize instantly' }
  ],
  'Statistics & Probability': [
    { name: 'Mean (Average)', expr: 'x̄ = Σx / n', note: 'Sum of all values ÷ count of values' },
    { name: 'Median', expr: 'M = middle value (data sorted)', note: 'Even count: average the two middle values' },
    { name: 'Mode', expr: 'Most frequently occurring value', note: 'A dataset can have multiple modes or none' },
    { name: 'Range', expr: 'Range = Max − Min', note: 'Spread of the data set' },
    { name: 'Percent Change', expr: '% Change = [(New − Old) / Old] × 100', note: 'Positive = increase; negative = decrease' },
    { name: 'Probability', expr: 'P(A) = (# favorable) / (# total)', note: '0 ≤ P(A) ≤ 1 always; P(impossible) = 0, P(certain) = 1' },
    { name: 'Complementary Events', expr: 'P(not A) = 1 − P(A)', note: 'The probability of an event NOT occurring' },
    { name: 'Conditional Probability', expr: 'P(A|B) = P(A ∩ B) / P(B)', note: 'Probability of A given that B has occurred' }
  ],
  'Trigonometry': [
    { name: 'Sine (SOH)', expr: 'sin θ = opposite / hypotenuse', note: 'SOH — the side opposite the angle over hypotenuse' },
    { name: 'Cosine (CAH)', expr: 'cos θ = adjacent / hypotenuse', note: 'CAH — the side adjacent to the angle over hypotenuse' },
    { name: 'Tangent (TOA)', expr: 'tan θ = opposite / adjacent', note: 'TOA — also equals sin θ / cos θ' },
    { name: 'Complementary Angles', expr: 'sin θ = cos(90° − θ)', note: 'Sin of any angle = cosine of its complement' },
    { name: 'Pythagorean Identity', expr: 'sin²θ + cos²θ = 1', note: 'True for all angles; derivable from a²+b²=c²' }
  ]
};

/* ── Roadmap Generator ──────────────────────────────────────── */
function generateRoadmap(currentScore, targetScore, testDate, weeklyHours) {
  const scoreDiff = targetScore - currentScore;
  const daysUntilTest = Math.max(7, Math.ceil((new Date(testDate) - new Date()) / (1000*60*60*24)));
  const weeksLeft = Math.ceil(daysUntilTest / 7);
  const totalHours = weeksLeft * weeklyHours;

  const topics = [];
  if (currentScore < 1200) topics.push('Linear Equations', 'Percentages & Ratios', 'Basic Grammar Rules', 'Reading for Main Idea');
  if (currentScore < 1300) topics.push('Systems of Equations', 'Quadratics (Factoring)', 'Transitions & Connectors', 'Evidence-Based Questions');
  if (currentScore < 1400) topics.push('Advanced Functions', 'Geometry & Trig', 'Rhetorical Synthesis', 'Words in Context');
  if (currentScore < 1500) topics.push('Exponential Models', 'Circles & Volume', 'Cross-Text Connections', 'Hard Grammar Conventions');
  if (currentScore >= 1500) topics.push('Hard Nonlinear Equations', 'Probability & Statistics', 'Command of Evidence', 'Desmos Speed Techniques');

  const weeks = [];
  for (let w = 0; w < Math.min(weeksLeft, 12); w++) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + w * 7);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);

    const topicA = topics[w % topics.length] || 'Mixed Practice';
    const topicB = topics[(w + 1) % topics.length] || 'Review';

    let title;
    if (w === 0) title = 'Diagnostic & Baseline';
    else if (w === weeksLeft - 1) title = 'Final Review & Test Simulation';
    else if (w % 4 === 3) title = `Week ${w+1}: Full Practice Test`;
    else title = `Week ${w+1}: ${topicA}`;

    weeks.push({
      week: w + 1, title,
      startDate: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      endDate: endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      completed: false, current: w === 0,
      tasks: [
        { icon: '📚', text: `Study: ${topicA}` },
        { icon: '🎥', text: `Watch 1-2 videos on ${topicB}` },
        { icon: '✏️', text: `Complete 20-25 practice questions` },
        { icon: '📊', text: `Review every wrong answer — find the pattern` },
        ...(w % 4 === 3 ? [{ icon: '📝', text: 'Take a timed full-length practice test (Bluebook)' }] : []),
        ...(w === 0 ? [{ icon: '🎯', text: 'Identify your 3 weakest topics from diagnostic' }] : [])
      ]
    });
  }

  return { currentScore, targetScore, testDate, weeksLeft, totalHours, scoreDiff, weeks, topics };
}