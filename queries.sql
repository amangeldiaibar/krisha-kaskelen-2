-- Готовые запросы к базе сайта.
-- Как запустить: выделите один запрос мышкой и нажмите ▶ (Run) вверху справа.
-- При первом запуске выберите подключение "localhost, krisha (krisha)".
-- База должна работать: npm start, npm run dev или npm run db.

-- Все аккаунты
SELECT id, name, phone, email, created_at FROM users;

-- Все объявления
SELECT id, title, deal, price, address, source_name, status, created_at FROM listings ORDER BY id;

-- Сколько объявлений из каждого источника
SELECT COALESCE(source_name, 'сайт') AS source, status, COUNT(*) AS ads FROM listings GROUP BY 1, 2 ORDER BY 1;

-- Сообщения чата: кто, в каком объявлении, что написал
SELECT messages.id, users.name AS sender, listings.title AS listing, messages.text, messages.created_at
FROM messages
JOIN users ON users.id = messages.sender_id
JOIN conversations ON conversations.id = messages.conversation_id
JOIN listings ON listings.id = conversations.listing_id
ORDER BY messages.id;

-- Кто сейчас вошёл в аккаунт
SELECT users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id;
