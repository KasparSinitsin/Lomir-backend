-- ============================================================
-- LOMIR BADGE AWARDS SEED SCRIPT
-- ============================================================
-- 
-- Purpose: Seed realistic badge awards across all 30 badges
-- 
-- Run this script in the Neon SQL Editor:
-- https://console.neon.tech/ → Your Project → SQL Editor
--
-- ============================================================

-- Step 1: Clear existing badge_awards
DELETE FROM badge_awards;

-- Step 2: Reset sequence
ALTER SEQUENCE badge_awards_id_seq RESTART WITH 1;

-- ============================================================
-- BADGE REFERENCE (IDs 115-144):
-- 
-- Collaboration Skills (Blue #3B82F6): 115-120
--   115 Team Player, 116 Mediator, 117 Communicator, 
--   118 Motivator, 119 Organizer, 120 Reliable
--
-- Technical Expertise (Green #10B981): 121-126
--   121 Coder, 122 Designer, 123 Data Whiz,
--   124 Tech Support, 125 Systems Thinker, 126 Documentation Master
--
-- Creative Thinking (Purple #8B5CF6): 127-132
--   127 Innovator, 128 Problem Solver, 129 Visionary,
--   130 Storyteller, 131 Artisan, 132 Outside-the-Box
--
-- Leadership Qualities (Red #EF4444): 133-138
--   133 Decision Maker, 134 Mentor, 135 Initiative Taker,
--   136 Delegator, 137 Strategic Planner, 138 Feedback Provider
--
-- Personal Attributes (Yellow #F59E0B): 139-144
--   139 Quick Learner, 140 Empathetic, 141 Persistent,
--   142 Detail-Oriented, 143 Adaptable, 144 Knowledge Sharer
-- ============================================================

-- Step 3: Insert varied badge awards
INSERT INTO badge_awards (awarded_to_user_id, badge_id, awarded_by_user_id, credits, reason, context_type, created_at, updated_at) VALUES

-- ============================================================
-- USER 86 (Johannes Danner) - Developer, gets technical + collab badges
-- ============================================================
(86, 121, 89, 3, 'Excellent coding skills on the project', 'team', '2025-10-15 10:30:00', NOW()),
(86, 121, 88, 2, 'Great React implementation', 'project', '2025-11-20 14:00:00', NOW()),
(86, 125, 90, 2, 'Understands the full architecture', 'team', '2025-12-01 09:00:00', NOW()),
(86, 115, 87, 3, 'Always helps teammates', 'profile', '2025-12-10 11:30:00', NOW()),
(86, 117, 89, 2, 'Clear technical explanations', 'chat', '2026-01-05 16:00:00', NOW()),

-- ============================================================
-- USER 87 (Jane Doe) - UX Designer, gets design + creative badges
-- ============================================================
(87, 122, 86, 3, 'Beautiful interface designs', 'project', '2025-10-20 10:00:00', NOW()),
(87, 122, 90, 2, 'Intuitive user flows', 'team', '2025-11-15 14:30:00', NOW()),
(87, 122, 88, 1, 'Clean visual hierarchy', 'profile', '2025-12-05 09:00:00', NOW()),
(87, 127, 89, 2, 'Creative solutions to UX problems', 'project', '2025-12-20 11:00:00', NOW()),
(87, 140, 86, 3, 'Really understands user needs', 'team', '2026-01-10 15:00:00', NOW()),
(87, 131, 90, 2, 'Artful attention to detail', 'profile', '2026-01-15 10:30:00', NOW()),

-- ============================================================
-- USER 88 (Robert Smith) - Full-stack, gets technical + leadership badges
-- ============================================================
(88, 121, 86, 3, 'Solid backend architecture', 'project', '2025-10-10 09:00:00', NOW()),
(88, 121, 89, 2, 'Clean code practices', 'team', '2025-11-05 14:00:00', NOW()),
(88, 124, 87, 2, 'Helped debug tricky issues', 'chat', '2025-11-25 16:30:00', NOW()),
(88, 133, 90, 3, 'Makes good technical decisions', 'team', '2025-12-15 10:00:00', NOW()),
(88, 126, 86, 2, 'Great API documentation', 'project', '2026-01-08 11:30:00', NOW()),

-- ============================================================
-- USER 89 (Alice Beurer) - Project Manager, gets leadership + collab badges
-- ============================================================
(89, 119, 86, 3, 'Keeps everything on track', 'team', '2025-10-12 10:00:00', NOW()),
(89, 119, 88, 2, 'Excellent sprint planning', 'project', '2025-11-08 14:30:00', NOW()),
(89, 119, 87, 2, 'Great timeline management', 'profile', '2025-12-03 09:00:00', NOW()),
(89, 118, 90, 3, 'Always motivates the team', 'team', '2025-12-18 11:00:00', NOW()),
(89, 133, 86, 2, 'Quick and thoughtful decisions', 'chat', '2026-01-12 15:30:00', NOW()),
(89, 137, 88, 3, 'Long-term vision for the project', 'project', '2026-01-20 10:00:00', NOW()),
(89, 115, 87, 2, 'Great team player', 'team', '2026-01-25 14:00:00', NOW()),

-- ============================================================
-- USER 90 (Mike Ross) - Mobile Dev, gets technical + personal badges
-- ============================================================
(90, 121, 86, 3, 'React Native expertise', 'project', '2025-10-18 10:30:00', NOW()),
(90, 121, 89, 2, 'Clean mobile architecture', 'team', '2025-11-12 14:00:00', NOW()),
(90, 128, 87, 2, 'Solved complex UI bug', 'chat', '2025-11-28 16:00:00', NOW()),
(90, 142, 88, 3, 'Catches edge cases others miss', 'project', '2025-12-22 09:30:00', NOW()),
(90, 139, 89, 2, 'Picked up new framework quickly', 'team', '2026-01-06 11:00:00', NOW()),

-- ============================================================
-- USER 91 (Jackson Martin) - Data Scientist, gets technical badges
-- ============================================================
(91, 123, 86, 3, 'Amazing data analysis', 'project', '2025-10-25 10:00:00', NOW()),
(91, 123, 89, 2, 'Clear data visualizations', 'team', '2025-11-18 14:30:00', NOW()),
(91, 125, 88, 2, 'Understands data pipelines', 'project', '2025-12-08 09:00:00', NOW()),
(91, 129, 90, 3, 'Visionary ML approach', 'team', '2026-01-02 11:30:00', NOW()),

-- ============================================================
-- USER 92 (Jayden Murphy) - IoT Developer
-- ============================================================
(92, 121, 88, 2, 'Great embedded code', 'project', '2025-10-22 10:30:00', NOW()),
(92, 125, 86, 3, 'Systems integration skills', 'team', '2025-11-15 14:00:00', NOW()),
(92, 128, 89, 2, 'Creative hardware solutions', 'profile', '2025-12-12 09:30:00', NOW()),

-- ============================================================
-- USER 93 (Riley Murphy) - Blockchain Dev
-- ============================================================
(93, 121, 90, 3, 'Solid smart contract code', 'project', '2025-10-28 10:00:00', NOW()),
(93, 127, 86, 2, 'Innovative Web3 ideas', 'team', '2025-11-22 14:30:00', NOW()),
(93, 132, 88, 3, 'Unconventional problem solving', 'chat', '2025-12-16 16:00:00', NOW()),

-- ============================================================
-- USER 94 (Grace Phillips) - UX/UI Designer
-- ============================================================
(94, 122, 87, 3, 'Beautiful interface work', 'project', '2025-10-30 10:30:00', NOW()),
(94, 122, 86, 2, 'Great attention to visual detail', 'team', '2025-11-25 14:00:00', NOW()),
(94, 131, 89, 2, 'Artistic design sense', 'profile', '2025-12-20 09:00:00', NOW()),
(94, 140, 90, 3, 'Understands user emotions', 'team', '2026-01-14 11:30:00', NOW()),

-- ============================================================
-- USER 95 (Michael König) - Content Creator
-- ============================================================
(95, 126, 86, 3, 'Excellent documentation', 'project', '2025-10-15 10:00:00', NOW()),
(95, 126, 88, 2, 'Clear tutorials', 'team', '2025-11-10 14:30:00', NOW()),
(95, 130, 89, 3, 'Compelling technical stories', 'profile', '2025-12-05 09:30:00', NOW()),
(95, 144, 87, 2, 'Shares knowledge generously', 'chat', '2026-01-09 16:00:00', NOW()),

-- ============================================================
-- USER 96 (Ella Brown) - Farm life enthusiast
-- ============================================================
(96, 141, 89, 3, 'Never gives up on challenges', 'team', '2025-11-01 10:00:00', NOW()),
(96, 143, 86, 2, 'Adapts to any situation', 'profile', '2025-12-01 14:30:00', NOW()),
(96, 140, 88, 2, 'Genuine care for others', 'team', '2026-01-05 09:00:00', NOW()),

-- ============================================================
-- USER 102 (Carter Wright) - Systems Architect
-- ============================================================
(102, 125, 86, 3, 'Brilliant systems design', 'project', '2025-10-20 10:30:00', NOW()),
(102, 125, 89, 2, 'Scalable architecture', 'team', '2025-11-15 14:00:00', NOW()),
(102, 137, 88, 3, 'Strategic technical planning', 'project', '2025-12-10 09:30:00', NOW()),
(102, 133, 90, 2, 'Good infrastructure decisions', 'team', '2026-01-04 11:00:00', NOW()),

-- ============================================================
-- USER 104 (John Thomas) - AR/VR Developer
-- ============================================================
(104, 121, 86, 2, 'Solid Unity development', 'project', '2025-10-22 10:00:00', NOW()),
(104, 127, 89, 3, 'Innovative VR experiences', 'team', '2025-11-18 14:30:00', NOW()),
(104, 132, 88, 2, 'Creative immersive solutions', 'profile', '2025-12-14 09:00:00', NOW()),

-- ============================================================
-- USER 105 (Scarlett Thomas) - Project Manager
-- ============================================================
(105, 119, 89, 3, 'Exceptional organization', 'team', '2025-10-25 10:30:00', NOW()),
(105, 136, 86, 2, 'Effective task delegation', 'project', '2025-11-20 14:00:00', NOW()),
(105, 117, 88, 3, 'Clear team communication', 'chat', '2025-12-18 16:00:00', NOW()),
(105, 134, 90, 2, 'Mentors junior team members', 'team', '2026-01-12 09:30:00', NOW()),

-- ============================================================
-- USER 109 (Ella Nelson) - DevOps Engineer
-- ============================================================
(109, 121, 88, 3, 'Excellent CI/CD pipelines', 'project', '2025-10-28 10:00:00', NOW()),
(109, 124, 86, 2, 'Great debugging support', 'chat', '2025-11-22 14:30:00', NOW()),
(109, 125, 89, 3, 'Deep AWS knowledge', 'team', '2025-12-16 09:00:00', NOW()),
(109, 120, 90, 2, 'Always delivers on time', 'project', '2026-01-10 11:30:00', NOW()),

-- ============================================================
-- USER 111 (Layla Vazquez) - AR/VR Developer
-- ============================================================
(111, 121, 86, 2, 'Creative VR implementations', 'project', '2025-10-30 10:30:00', NOW()),
(111, 131, 89, 3, 'Artistic 3D work', 'team', '2025-11-25 14:00:00', NOW()),
(111, 127, 87, 2, 'Innovative experience design', 'profile', '2025-12-20 09:30:00', NOW()),

-- ============================================================
-- USER 113 (Olivia Verro) - Blockchain Developer
-- ============================================================
(113, 121, 88, 3, 'Python expertise', 'project', '2025-10-15 10:00:00', NOW()),
(113, 121, 90, 2, 'Clean smart contracts', 'team', '2025-11-10 14:30:00', NOW()),
(113, 128, 86, 2, 'Solves complex problems', 'chat', '2025-12-05 16:00:00', NOW()),
(113, 139, 89, 3, 'Quick to learn new chains', 'team', '2026-01-09 09:00:00', NOW()),

-- ============================================================
-- USER 116 (Amelia Jones) - Product Manager
-- ============================================================
(116, 129, 89, 3, 'Great product vision', 'team', '2025-10-18 10:30:00', NOW()),
(116, 140, 86, 2, 'Deeply understands users', 'project', '2025-11-12 14:00:00', NOW()),
(116, 117, 88, 3, 'Excellent stakeholder communication', 'chat', '2025-12-08 16:30:00', NOW()),
(116, 133, 90, 2, 'Makes good product decisions', 'team', '2026-01-06 09:30:00', NOW()),

-- ============================================================
-- USER 119 (Hannah Cook) - Graphic Designer
-- ============================================================
(119, 122, 87, 3, 'Stunning brand designs', 'project', '2025-10-20 10:00:00', NOW()),
(119, 131, 86, 2, 'Artistic excellence', 'team', '2025-11-15 14:30:00', NOW()),
(119, 142, 89, 2, 'Perfect pixel attention', 'profile', '2025-12-12 09:00:00', NOW()),

-- ============================================================
-- USER 121 (Amelia Turner) - Game Developer
-- ============================================================
(121, 121, 86, 3, 'Great Unity skills', 'project', '2025-10-22 10:30:00', NOW()),
(121, 127, 88, 2, 'Innovative game mechanics', 'team', '2025-11-18 14:00:00', NOW()),
(121, 132, 89, 3, 'Creative gameplay solutions', 'project', '2025-12-14 09:30:00', NOW()),
(121, 141, 90, 2, 'Persistent bug fixing', 'chat', '2026-01-10 16:00:00', NOW()),

-- ============================================================
-- USER 123 (Charlotte Kammerer) - Project Manager with coaching bg
-- ============================================================
(123, 134, 89, 3, 'Excellent mentoring skills', 'team', '2025-10-25 10:00:00', NOW()),
(123, 134, 86, 2, 'Supportive guidance', 'profile', '2025-11-20 14:30:00', NOW()),
(123, 140, 88, 3, 'Deep empathy for team', 'team', '2025-12-18 09:00:00', NOW()),
(123, 116, 90, 2, 'Helps resolve conflicts', 'chat', '2026-01-14 11:30:00', NOW()),
(123, 138, 87, 2, 'Constructive feedback', 'project', '2026-01-22 10:00:00', NOW()),

-- ============================================================
-- Additional badges to ensure all 30 are tested
-- ============================================================

-- Badge 116 (Mediator)
(94, 116, 86, 2, 'Helps find middle ground', 'team', '2025-11-05 10:00:00', NOW()),

-- Badge 120 (Reliable)
(91, 120, 89, 3, 'Always delivers quality work', 'project', '2025-12-01 14:00:00', NOW()),
(95, 120, 86, 2, 'Consistent and dependable', 'team', '2026-01-03 09:30:00', NOW()),

-- Badge 135 (Initiative Taker)
(90, 135, 86, 3, 'Takes initiative on new features', 'project', '2025-11-28 10:30:00', NOW()),
(88, 135, 89, 2, 'Proactively improves codebase', 'team', '2025-12-22 14:00:00', NOW()),

-- Badge 138 (Feedback Provider)
(86, 138, 89, 2, 'Gives helpful code reviews', 'project', '2025-12-28 09:00:00', NOW()),
(88, 138, 87, 3, 'Constructive PR feedback', 'chat', '2026-01-18 16:00:00', NOW()),

-- Badge 143 (Adaptable)
(87, 143, 88, 2, 'Adapts designs to feedback', 'project', '2025-12-15 10:30:00', NOW()),
(91, 143, 86, 3, 'Flexible with changing requirements', 'team', '2026-01-08 14:00:00', NOW()),

-- ============================================================
-- More users with varied badges
-- ============================================================

-- User 106 (Fjodor Ivanov) - Blockchain
(106, 121, 88, 2, 'Smart contract expertise', 'project', '2025-11-01 10:00:00', NOW()),
(106, 132, 89, 3, 'Unconventional solutions', 'team', '2025-12-05 14:30:00', NOW()),

-- User 107 (Isaac Anderson) - UX/UI
(107, 122, 87, 3, 'Intuitive interface design', 'project', '2025-11-08 10:30:00', NOW()),
(107, 140, 86, 2, 'User-centered approach', 'team', '2025-12-12 14:00:00', NOW()),

-- User 108 (Isaac Smith) - UX/UI
(108, 122, 94, 2, 'Great visual design', 'project', '2025-11-12 10:00:00', NOW()),
(108, 131, 87, 3, 'Artistic creativity', 'team', '2025-12-18 14:30:00', NOW()),

-- User 110 (Sebastian Young) - Violinist
(110, 130, 89, 3, 'Compelling storytelling', 'profile', '2025-11-15 10:30:00', NOW()),
(110, 143, 86, 2, 'Adapts to any performance', 'team', '2025-12-22 14:00:00', NOW()),

-- User 112 (Evelyn Rodriguez) - Graphic Designer
(112, 122, 87, 3, 'Excellent branding work', 'project', '2025-11-18 10:00:00', NOW()),
(112, 131, 94, 2, 'Artistic marketing materials', 'team', '2025-12-25 14:30:00', NOW()),
(112, 142, 86, 2, 'Attention to brand details', 'profile', '2026-01-15 09:00:00', NOW()),

-- User 114 (Penelope White) - Blockchain
(114, 121, 113, 2, 'Solid Web3 code', 'project', '2025-11-22 10:30:00', NOW()),
(114, 139, 86, 3, 'Quick blockchain learner', 'team', '2025-12-28 14:00:00', NOW()),

-- User 115 (Abigail Lee) - Data Scientist
(115, 123, 91, 3, 'ML expertise', 'project', '2025-11-25 10:00:00', NOW()),
(115, 129, 86, 2, 'AI vision', 'team', '2026-01-02 14:30:00', NOW()),

-- User 118 (Zoey Stewart) - E-commerce
(118, 121, 88, 2, 'Solid e-commerce code', 'project', '2025-11-28 10:30:00', NOW()),
(118, 128, 86, 3, 'Creative checkout solutions', 'team', '2026-01-05 14:00:00', NOW()),

-- User 120 (Camila Sanchez) - E-commerce
(120, 121, 86, 2, 'Clean retail code', 'project', '2025-12-01 10:00:00', NOW()),
(120, 142, 89, 3, 'Catches payment edge cases', 'team', '2026-01-08 14:30:00', NOW()),

-- User 122 (Samuel Green) - Frontend
(122, 121, 88, 3, 'React expertise', 'project', '2025-12-05 10:30:00', NOW()),
(122, 122, 87, 2, 'CSS mastery', 'team', '2026-01-12 14:00:00', NOW());


-- ============================================================
-- VERIFICATION QUERIES (run these after the INSERT to confirm)
-- ============================================================

-- Check badge distribution
SELECT b.name, b.category, COUNT(*) as award_count, SUM(ba.credits) as total_credits
FROM badge_awards ba
JOIN badges b ON ba.badge_id = b.id
GROUP BY b.id, b.name, b.category
ORDER BY b.category, b.name;

-- Check user badge counts
SELECT u.first_name || ' ' || u.last_name as user_name, 
       COUNT(DISTINCT ba.badge_id) as unique_badges,
       COUNT(*) as total_awards,
       SUM(ba.credits) as total_credits
FROM badge_awards ba
JOIN users u ON ba.awarded_to_user_id = u.id
GROUP BY u.id, u.first_name, u.last_name
ORDER BY total_credits DESC
LIMIT 20;

-- Verify all 30 badges are used
SELECT COUNT(DISTINCT badge_id) as badges_used FROM badge_awards;
