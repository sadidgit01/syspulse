COMPOSE = docker compose

.PHONY: up down logs migrate seed

up:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f postgres redis api web

migrate:
	$(COMPOSE) run --rm api alembic upgrade head

seed:
	$(COMPOSE) run --rm api python -m app.seed
