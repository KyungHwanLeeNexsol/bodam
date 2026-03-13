# Bodam Insurance AI Platform - Project Structure

## Overview

Bodam is a monorepo-based insurance AI platform that leverages large language models to provide intelligent policy analysis and coverage advice. The architecture separates frontend and backend concerns while maintaining tight integration through a Backend-For-Frontend (BFF) pattern, enabling a solo developer to maintain both systems effectively.

**Core Technology Stack:**
- Frontend: Next.js 16 with TypeScript and Tailwind CSS
- Backend: Python FastAPI with async/await architecture
- Database: PostgreSQL with SQLAlchemy ORM
- AI/ML: Multi-LLM router with RAG (Retrieval-Augmented Generation) pipeline
- Infrastructure: Docker containerization with docker-compose for local development

---

## Directory Structure

```
bodam/
├── frontend/                    # Next.js 16 frontend application
│   ├── app/                     # Next.js App Router (file-system routing)
│   │   ├── (auth)/              # Authentication route group
│   │   │   ├── login/           # User login page
│   │   │   ├── register/        # User registration page
│   │   │   └── layout.tsx       # Auth layout with navbar
│   │   │
│   │   ├── (main)/              # Main application routes (protected)
│   │   │   ├── chat/            # Chat interface (primary feature)
│   │   │   ├── policies/        # Policy management and listing
│   │   │   ├── dashboard/       # User dashboard with analytics
│   │   │   └── layout.tsx       # Main app layout
│   │   │
│   │   ├── api/                 # Backend-For-Frontend (BFF) API routes
│   │   │   ├── auth/            # Auth endpoints (login, logout, verify)
│   │   │   ├── chat/            # Chat proxy endpoints
│   │   │   ├── policies/        # Policy CRUD endpoints
│   │   │   └── [...]            # Other proxy routes to FastAPI
│   │   │
│   │   ├── _app.tsx             # App-level configuration and providers
│   │   ├── layout.tsx           # Root layout
│   │   └── page.tsx             # Landing page
│   │
│   ├── components/              # Reusable React components
│   │   ├── ui/                  # shadcn/ui base components
│   │   │   ├── button.tsx       # Button component
│   │   │   ├── input.tsx        # Input component
│   │   │   ├── dialog.tsx       # Dialog/modal component
│   │   │   └── [...]            # Other UI primitives
│   │   │
│   │   ├── chat/                # Chat feature components
│   │   │   ├── ChatMessage.tsx  # Individual message display
│   │   │   ├── ChatInput.tsx    # Message input form
│   │   │   ├── ChatHistory.tsx  # Conversation list
│   │   │   └── ChatWindow.tsx   # Main chat container
│   │   │
│   │   ├── policy/              # Policy management components
│   │   │   ├── PolicyCard.tsx   # Policy display card
│   │   │   ├── PolicyList.tsx   # List of policies
│   │   │   ├── PolicyForm.tsx   # Policy creation/edit form
│   │   │   └── CoverageDetail.tsx # Coverage breakdown
│   │   │
│   │   ├── auth/                # Authentication components
│   │   │   ├── LoginForm.tsx    # Login form
│   │   │   ├── RegisterForm.tsx # Registration form
│   │   │   └── ProtectedRoute.tsx # Route protection wrapper
│   │   │
│   │   └── layout/              # Layout components
│   │       ├── Navbar.tsx       # Navigation bar
│   │       ├── Sidebar.tsx      # Sidebar navigation
│   │       └── Footer.tsx       # Footer component
│   │
│   ├── lib/                     # Utility functions and helpers
│   │   ├── api-client.ts        # Axios instance for API calls
│   │   ├── auth-utils.ts        # Authentication utilities
│   │   ├── validation.ts        # Form validation schemas
│   │   └── formatters.ts        # Data formatting utilities
│   │
│   ├── hooks/                   # Custom React hooks
│   │   ├── useAuth.ts           # Authentication state hook
│   │   ├── useChat.ts           # Chat state management
│   │   ├── usePolicy.ts         # Policy management hook
│   │   └── usePagination.ts     # Pagination logic
│   │
│   ├── types/                   # TypeScript type definitions
│   │   ├── auth.ts              # Auth-related types
│   │   ├── chat.ts              # Chat types (Message, Conversation)
│   │   ├── policy.ts            # Policy types
│   │   └── api.ts               # API response types
│   │
│   ├── styles/                  # Global styles
│   │   ├── globals.css          # Global CSS
│   │   └── variables.css        # CSS variables
│   │
│   ├── public/                  # Static assets
│   │   ├── images/              # Image assets
│   │   ├── icons/               # Icon assets
│   │   └── fonts/               # Custom fonts
│   │
│   ├── .env.local               # Local environment variables (git-ignored)
│   ├── .env.example             # Example env file template
│   ├── next.config.js           # Next.js configuration
│   ├── tsconfig.json            # TypeScript configuration
│   ├── tailwind.config.ts       # Tailwind CSS configuration
│   ├── package.json             # Dependencies and scripts
│   └── README.md                # Frontend documentation
│
├── backend/                     # Python FastAPI application
│   ├── app/
│   │   ├── api/                 # API endpoint definitions
│   │   │   ├── v1/              # API version 1 routes
│   │   │   │   ├── chat.py      # Chat endpoints (POST, GET history)
│   │   │   │   ├── policies.py  # Policy CRUD endpoints
│   │   │   │   ├── auth.py      # Authentication endpoints
│   │   │   │   ├── analysis.py  # Coverage analysis endpoints
│   │   │   │   └── users.py     # User profile endpoints
│   │   │   │
│   │   │   └── deps.py          # Dependency injection (auth, db sessions)
│   │   │
│   │   ├── core/                # Core application configuration
│   │   │   ├── config.py        # Environment and app settings
│   │   │   ├── security.py      # JWT, password hashing, auth logic
│   │   │   ├── database.py      # Database connection and session
│   │   │   └── logging.py       # Logging configuration
│   │   │
│   │   ├── models/              # SQLAlchemy ORM models
│   │   │   ├── user.py          # User model
│   │   │   ├── policy.py        # Policy model
│   │   │   ├── conversation.py  # Chat conversation model
│   │   │   ├── message.py       # Chat message model
│   │   │   └── __init__.py      # Model exports
│   │   │
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   │   ├── auth.py          # Auth request/response schemas
│   │   │   ├── policy.py        # Policy schemas
│   │   │   ├── chat.py          # Chat message/conversation schemas
│   │   │   ├── user.py          # User schemas
│   │   │   └── __init__.py      # Schema exports
│   │   │
│   │   ├── services/            # Business logic layer
│   │   │   ├── rag/             # RAG pipeline implementation
│   │   │   │   ├── embeddings.py    # Vector embeddings generation
│   │   │   │   ├── retriever.py     # Document retrieval logic
│   │   │   │   ├── vector_store.py  # Vector database interface
│   │   │   │   └── chain.py         # RAG chain orchestration
│   │   │   │
│   │   │   ├── llm/             # LLM integration and routing
│   │   │   │   ├── router.py        # Multi-LLM router (cost optimization)
│   │   │   │   ├── prompts.py       # Prompt templates and engineering
│   │   │   │   ├── chat_service.py  # Chat completion service
│   │   │   │   └── config.py        # LLM configuration
│   │   │   │
│   │   │   ├── crawler/         # Insurance website crawlers
│   │   │   │   ├── base_crawler.py  # Base crawler class
│   │   │   │   ├── geico_crawler.py # GEICO-specific crawler
│   │   │   │   ├── progressive_crawler.py # Progressive-specific
│   │   │   │   └── state_farm_crawler.py  # StateFarm-specific
│   │   │   │
│   │   │   ├── parser/          # PDF and document parsing
│   │   │   │   ├── pdf_parser.py    # PDF extraction and parsing
│   │   │   │   ├── text_cleaner.py  # Text preprocessing
│   │   │   │   └── document_processor.py # Multi-format processor
│   │   │   │
│   │   │   ├── analysis/        # Coverage analysis logic
│   │   │   │   ├── coverage_analyzer.py  # Coverage gap detection
│   │   │   │   ├── policy_recommender.py # Policy recommendations
│   │   │   │   └── comparison.py         # Policy comparison logic
│   │   │   │
│   │   │   └── auth/            # Authentication service
│   │   │       ├── auth_service.py  # User auth logic
│   │   │       └── token_service.py # JWT token management
│   │   │
│   │   ├── workers/             # Background task processing
│   │   │   ├── celery_app.py    # Celery configuration
│   │   │   ├── tasks.py         # Background job definitions
│   │   │   │   ├── crawl_policies # Scheduled crawling task
│   │   │   │   ├── process_documents # Document processing task
│   │   │   │   └── generate_embeddings # Vector generation task
│   │   │   │
│   │   │   └── queue/           # Job queue interfaces
│   │   │       └── base_queue.py
│   │   │
│   │   ├── __init__.py          # App initialization
│   │   └── main.py              # FastAPI app creation and startup
│   │
│   ├── tests/                   # Test files
│   │   ├── unit/                # Unit tests
│   │   │   ├── test_auth.py
│   │   │   ├── test_policies.py
│   │   │   └── test_llm_router.py
│   │   │
│   │   ├── integration/         # Integration tests
│   │   │   ├── test_chat_endpoint.py
│   │   │   ├── test_policy_crud.py
│   │   │   └── test_rag_pipeline.py
│   │   │
│   │   ├── fixtures/            # Test data and fixtures
│   │   │   ├── conftest.py      # Pytest configuration
│   │   │   ├── factories.py     # Data factories
│   │   │   └── mocks.py         # Mock objects
│   │   │
│   │   └── __init__.py
│   │
│   ├── alembic/                 # Database migrations
│   │   ├── versions/            # Migration files
│   │   ├── env.py              # Alembic environment
│   │   ├── script.py.mako      # Migration template
│   │   └── alembic.ini         # Alembic configuration
│   │
│   ├── scripts/                 # Utility scripts
│   │   ├── init_db.py          # Database initialization
│   │   ├── seed_data.py        # Load sample data
│   │   └── crawl_policies.py   # Manual crawling script
│   │
│   ├── .env.local               # Local environment variables (git-ignored)
│   ├── .env.example             # Example env file template
│   ├── requirements.txt         # Python dependencies
│   ├── requirements-dev.txt     # Development dependencies
│   ├── pyproject.toml           # Poetry/project configuration
│   ├── pytest.ini               # Pytest configuration
│   └── README.md                # Backend documentation
│
├── data/                        # Data assets and knowledge base
│   ├── knowledge/               # Insurance knowledge base (Layer 1)
│   │   ├── policy_templates/    # Standard policy templates
│   │   │   ├── auto_insurance.md
│   │   │   ├── home_insurance.md
│   │   │   └── life_insurance.md
│   │   │
│   │   ├── coverage_guides/     # Coverage explanation documents
│   │   │   ├── deductibles.md
│   │   │   ├── copays.md
│   │   │   └── exclusions.md
│   │   │
│   │   └── faqs/                # Frequently asked questions
│   │       ├── auto_faq.md
│   │       ├── home_faq.md
│   │       └── claims_faq.md
│   │
│   └── templates/               # Prompt templates and configurations
│       ├── system_prompts.json  # System prompt definitions
│       ├── few_shot_examples.json # In-context learning examples
│       └── classification_rules.json # Policy classification logic
│
├── infra/                       # Infrastructure as Code
│   ├── docker/                  # Docker configurations
│   │   ├── Dockerfile.frontend  # Next.js image
│   │   ├── Dockerfile.backend   # FastAPI image
│   │   └── Dockerfile.postgres  # PostgreSQL with custom init
│   │
│   ├── docker-compose.yml       # Local development stack
│   │   # Services: frontend, backend, postgres, redis
│   │   # Volumes: postgres data, redis cache
│   │   # Networks: internal bridging
│   │
│   ├── kubernetes/              # Kubernetes manifests (future)
│   │   └── README.md
│   │
│   └── nginx/                   # Nginx configuration (future)
│       └── nginx.conf
│
├── .moai/                       # MoAI project configuration
│   ├── config/                  # Configuration files
│   │   ├── sections/            # Configuration sections
│   │   │   ├── quality.yaml     # Quality gates and testing
│   │   │   ├── workflow.yaml    # Workflow configuration
│   │   │   ├── user.yaml        # User preferences
│   │   │   └── language.yaml    # Language settings
│   │   │
│   │   └── moai.yaml            # Main MoAI configuration
│   │
│   ├── specs/                   # SPEC-first specifications
│   │   ├── SPEC-AUTH-001/       # Authentication system SPEC
│   │   │   └── spec.md
│   │   ├── SPEC-CHAT-001/       # Chat feature SPEC
│   │   │   └── spec.md
│   │   ├── SPEC-POLICY-001/     # Policy management SPEC
│   │   │   └── spec.md
│   │   └── SPEC-RAG-001/        # RAG pipeline SPEC
│   │       └── spec.md
│   │
│   ├── docs/                    # Generated documentation
│   │   ├── api/                 # API documentation
│   │   ├── architecture/        # Architecture diagrams
│   │   └── guides/              # User guides
│   │
│   └── project/                 # Project metadata
│       └── structure.md         # This file
│
├── docs/                        # Comprehensive documentation
│   ├── architecture/            # System architecture docs
│   │   ├── system-design.md    # Overall system design
│   │   ├── data-flow.md        # Data flow diagrams
│   │   └── component-interactions.md # Component diagram
│   │
│   ├── guides/                  # Developer and user guides
│   │   ├── getting-started.md  # Getting started guide
│   │   ├── development-setup.md # Local dev environment
│   │   ├── api-guide.md        # API documentation
│   │   └── deployment.md       # Deployment guide
│   │
│   ├── features/                # Feature documentation
│   │   ├── chat-feature.md     # Chat interface guide
│   │   ├── policy-management.md # Policy management guide
│   │   └── coverage-analysis.md # Coverage analysis guide
│   │
│   └── index.md                 # Documentation index
│
├── .gitignore                   # Git ignore rules
├── .github/                     # GitHub configuration
│   ├── workflows/               # CI/CD workflows
│   │   ├── test.yml            # Test pipeline
│   │   ├── build.yml           # Build pipeline
│   │   └── deploy.yml          # Deployment pipeline
│   │
│   └── ISSUE_TEMPLATE/          # Issue templates
│       ├── bug_report.md
│       └── feature_request.md
│
├── docker-compose.yml           # Root docker-compose for full stack
├── package.json                 # Root monorepo script (optional)
├── README.md                    # Project overview
├── CHANGELOG.md                 # Version history
└── LICENSE                      # Project license (MIT)
```

---

## Architecture Patterns

### 1. Monorepo Structure

The Bodam project uses a monorepo pattern combining frontend and backend in a single repository. This approach reduces context switching for solo development while maintaining clear separation of concerns through distinct directories.

**Benefits:**
- Unified version control and release cycle
- Simplified local development with docker-compose
- Atomic commits for related frontend/backend changes
- Easier dependency management through shared version numbers

### 2. Backend-For-Frontend (BFF) Pattern

The Next.js API routes (frontend/app/api/) serve as a Backend-For-Frontend layer that proxies requests to the FastAPI backend. This pattern provides several advantages:

**Frontend API Routes Benefits:**
- Authentication middleware enforcement
- Request validation and sanitization
- Response transformation for frontend needs
- Rate limiting and request logging
- Decoupling frontend from backend API contracts

**Implementation Pattern:**
- Frontend makes requests to /api/v1/* endpoints
- API routes validate and transform requests
- Routes proxy to backend at http://backend:8000/api/v1/*
- Responses are transformed for frontend consumption

### 3. Service Layer Architecture

The backend follows a clean service layer pattern separating business logic from HTTP endpoints.

**Service Organization:**
- **RAG Service**: Handles document embedding and retrieval
- **LLM Service**: Manages multi-model LLM routing and chat completions
- **Crawler Service**: Orchestrates insurance policy crawling
- **Parser Service**: Processes PDF and text documents
- **Analysis Service**: Implements coverage analysis algorithms
- **Auth Service**: Manages user authentication and authorization

### 4. RAG (Retrieval-Augmented Generation) Pipeline

The platform implements a comprehensive RAG system for intelligent policy analysis:

**Pipeline Stages:**
1. **Collection**: Insurance policy documents from web crawlers and uploads
2. **Processing**: PDF parsing, text cleaning, and segmentation
3. **Embedding**: Vector generation using embedding models
4. **Storage**: Vector storage in database with metadata indexing
5. **Retrieval**: Semantic search for relevant policy sections
6. **Generation**: LLM-based response generation with context

**Knowledge Base Layers:**
- Layer 1 (Static): Insurance policy templates and standard coverage guides
- Layer 2 (Dynamic): User-uploaded policy documents
- Layer 3 (Live): Web-crawled policy information

### 5. Multi-LLM Router

The platform implements an intelligent multi-model LLM router for cost optimization and performance:

**Routing Strategies:**
- **Complex Reasoning**: Route to larger models (GPT-4, Claude 3 Opus)
- **Simple Classification**: Route to smaller models (GPT-3.5, Claude 3 Haiku)
- **Cost Optimization**: Fallback to cheaper models when accuracy permits
- **Failover Logic**: Automatic fallback if primary model unavailable

**Model Configuration:**
Models are configured in the LLM service with pricing tiers, latency specifications, capability vectors, and fallback chains. The router analyzes input complexity and cost/performance tradeoffs before selecting an appropriate model.

### 6. Data Model Structure

**User Entity:**
- Authentication credentials (email, password hash)
- Profile information (name, contact)
- Preferences (language, notification settings)
- Created/updated timestamps

**Policy Entity:**
- Policy metadata (number, holder, dates)
- Coverage information (types, limits, deductibles)
- Document references (PDF storage)
- Associated user reference

**Conversation Entity:**
- User reference
- Creation timestamp
- Status tracking

**Message Entity:**
- Conversation reference
- Role (user or assistant)
- Content and metadata
- Timestamps

---

## Key Components and Responsibilities

### Frontend Layer (Next.js)

**Page Organization:**
- Auth pages handle login, registration, and account management
- Main app pages include chat interface, policy management, and dashboard
- API routes proxy to backend and handle request/response transformation

**Component Strategy:**
- UI components from shadcn/ui provide accessibility and consistency
- Feature-specific components in dedicated directories (chat, policy, auth)
- Layout components manage page structure and navigation
- Reusable utilities in lib/ for API client, validation, and formatting

**State Management:**
- React hooks for local component state
- TanStack Query (React Query) for server state and caching
- Context API for authentication state
- LocalStorage for persistence

### Backend Layer (FastAPI)

**Endpoint Organization:**
- /api/v1/chat/* for conversation endpoints
- /api/v1/policies/* for policy management
- /api/v1/auth/* for authentication
- /api/v1/analysis/* for coverage analysis

**Service Integration:**
- Dependency injection provides database sessions and auth context
- Services encapsulate business logic
- Models define database schema
- Schemas handle request/response validation

**Background Processing:**
- Celery workers handle long-running tasks
- Policy crawling runs on schedule
- Document processing happens asynchronously
- Vector embedding generation in background

### Database Layer (PostgreSQL)

**Schema Design:**
- Normalized tables for users, policies, conversations, messages
- Relationships enforced through foreign keys
- Indexes on frequently queried columns
- Full-text search support for policy content

**Migrations:**
- Alembic manages schema versions
- All changes tracked in versions/ directory
- Forward and backward migrations supported
- Production rollout through migration pipeline

---

## Development Workflows

### Local Development Environment

**Docker Compose Stack:**
- Frontend: Next.js dev server on port 3000
- Backend: FastAPI dev server on port 8000
- Database: PostgreSQL on port 5432
- Cache: Redis on port 6379

**Startup Process:**
1. Clone repository
2. Copy .env.example files to .env.local
3. Run `docker-compose up` for full stack
4. Frontend available at http://localhost:3000
5. API available at http://localhost:8000/docs

### Feature Development Workflow

**Backend Feature:**
1. Create SPEC for requirements (SPEC-FEATURE-001)
2. Implement in appropriate service directory
3. Add API endpoint(s) in routes
4. Add request/response schemas
5. Create unit and integration tests
6. Document in architecture guides

**Frontend Feature:**
1. Review SPEC and API contract
2. Create components in feature-specific directory
3. Add types to types/ directory
4. Implement hooks for state management
5. Create page(s) using App Router
6. Add to navigation and routing
7. Test component integration

**Integration:**
1. Ensure API contract matches frontend expectations
2. Test full request/response cycle
3. Verify authentication and authorization
4. Test error handling and edge cases

---

## Deployment Architecture

**Container Strategy:**
- Separate Docker images for frontend and backend
- Docker Compose for local development
- Kubernetes manifests for production (future)

**Deployment Environments:**
- Local: docker-compose.yml for full stack
- Staging: Cloud deployment for testing
- Production: Managed Kubernetes or container orchestration

**CI/CD Pipeline:**
- GitHub Actions for automated testing
- Build pipeline validates code quality
- Test pipeline ensures coverage thresholds
- Deploy pipeline handles release management

---

## Technology Decisions and Rationale

**Next.js 16:**
- File-system routing reduces boilerplate
- App Router provides modern feature support
- Built-in API routes enable BFF pattern
- Excellent TypeScript support

**FastAPI:**
- Async/await for high concurrency
- Automatic OpenAPI documentation
- Pydantic for validation and serialization
- Fast development with minimal boilerplate

**PostgreSQL:**
- Mature, reliable relational database
- Advanced features (full-text search, JSON columns)
- Strong ecosystem and community support
- Excellent TypeScript ORM support via SQLAlchemy

**Docker:**
- Consistent local and production environments
- Easy dependency management
- Simplified deployment process
- Better team collaboration

---

## File Naming Conventions

**Backend:**
- Files: snake_case (auth_service.py, pdf_parser.py)
- Classes: PascalCase (AuthService, PDFParser)
- Functions: snake_case (parse_pdf, extract_text)
- Constants: UPPER_SNAKE_CASE (MAX_FILE_SIZE, API_KEY)

**Frontend:**
- Files: PascalCase for components (ChatMessage.tsx, PolicyCard.tsx)
- Files: camelCase for utilities (authUtils.ts, validationSchemas.ts)
- Classes: PascalCase (AuthService)
- Constants: UPPER_SNAKE_CASE (MAX_MESSAGE_LENGTH)

---

## Documentation Standards

**Code Documentation:**
- Docstrings for all public functions and classes
- Type hints required for Python functions
- JSDoc comments for TypeScript functions
- Inline comments for complex logic

**Architecture Documentation:**
- SPEC documents define feature requirements
- Architecture diagrams in docs/architecture/
- API documentation in docs/guides/
- Deployment guides in docs/guides/

**Commit Messages:**
- Conventional commits format: type(scope): description
- Types: feat, fix, docs, refactor, test, chore
- Examples: feat(chat): add message streaming, fix(auth): handle token expiry

---

## Performance Considerations

**Frontend Optimization:**
- Code splitting with dynamic imports
- Image optimization with Next.js Image component
- Caching strategies for API responses
- Lazy loading for heavy components

**Backend Optimization:**
- Database query optimization with proper indexing
- Connection pooling for database
- Caching layer with Redis
- Async/await for concurrent processing

**RAG Pipeline Optimization:**
- Batch embedding generation
- Efficient vector search algorithms
- Incremental document processing
- Smart chunking for context preservation

---

## Security Considerations

**Authentication:**
- JWT token-based authentication
- Secure password hashing with bcrypt
- Token refresh mechanism
- CSRF protection on forms

**API Security:**
- Request validation and sanitization
- Rate limiting per endpoint
- CORS configuration for frontend
- Input validation with Pydantic

**Data Protection:**
- Database encryption at rest
- TLS/SSL for API communication
- Environment variables for secrets
- API key management for external services

---

## Version Control Strategy

**Branching Model:**
- main: Production-ready code
- develop: Integration branch for features
- feature/*: Feature branches from develop
- hotfix/*: Urgent fixes from main

**Commit Strategy:**
- Atomic commits with clear messages
- Related frontend and backend changes together
- One feature per commit where possible
- Rebase and merge to maintain linear history

---

This document represents the planned architecture for Bodam Insurance AI Platform. As the project evolves, this structure should be updated to reflect any changes or optimizations discovered during development. Refer to individual README.md files in each major directory for detailed technical information specific to that component.
