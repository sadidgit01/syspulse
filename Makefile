COMPOSE = docker compose
PROD_COMPOSE = docker compose -f docker-compose.prod.yml

.PHONY: up down logs migrate seed restart-api shell-api shell-db prod-up prod-down prod-logs prod-deploy

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

migrate:
	$(COMPOSE) exec api alembic upgrade head

seed:
	$(COMPOSE) exec api python -m app.seed

restart-api:
	$(COMPOSE) restart api

shell-api:
	$(COMPOSE) exec api bash

shell-db:
	$(COMPOSE) exec postgres psql -U syspulse syspulse

prod-up:
	$(PROD_COMPOSE) up -d

prod-down:
	$(PROD_COMPOSE) down

prod-logs:
	$(PROD_COMPOSE) logs -f

prod-deploy:
	git pull && $(PROD_COMPOSE) up -d --build
