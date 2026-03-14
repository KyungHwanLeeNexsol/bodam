# Bodam (보담) - Insurance Claim Guidance Platform

## Product Overview

**Project Name**: Bodam (보담)
**Tagline**: AI-powered Insurance Claim Guidance Platform
**Version**: Pre-launch
**Status**: Product Definition Phase

Bodam is an AI-powered insurance claim guidance platform designed to help Korean insurance policyholders understand their coverage and determine claim eligibility. By answering natural language questions about insurance compensation, Bodam provides comprehensive guidance about which coverage types (담보) may apply to specific situations, using a conversational AI interface similar to ChatGPT or Gemini.

## Problem Statement

Korean insurance policyholders face significant challenges when trying to understand their coverage:

- **Complex Policy Language**: Insurance policies (약관) are written in technical, legalistic Korean that is difficult for average consumers to understand
- **Unclear Coverage Eligibility**: Determining whether a specific medical procedure, treatment, or situation is covered requires deep knowledge of policy terms and insurance categories
- **Information Asymmetry**: Policyholders lack accessible tools to independently verify coverage before claiming or to understand rejection reasons
- **Manual Process**: Currently, policyholders must contact insurance companies directly, leading to long wait times and inconsistent answers
- **Appeal Barriers**: When claims are denied, policyholders struggle to understand why or how to appeal effectively

## Solution

Bodam provides an intelligent, conversational platform that democratizes access to insurance claim guidance. The platform combines three core components:

1. **Insurance Policy Database**: A comprehensive, pre-indexed database of policy terms from all Korean insurance companies, including both current and discontinued products
2. **AI-Powered Claim Analysis**: Real-time analysis using large language models to determine coverage eligibility and identify applicable coverage items
3. **Conversational Interface**: A ChatGPT/Gemini-style chatbot that makes insurance guidance accessible and intuitive

## Target Audience

### Primary Users (Phase 1)

- **Individual Policyholders**: Korean insurance policyholders seeking to understand their coverage and claim eligibility
- **Medical Procedure Planners**: People preparing for surgeries or treatments who want to verify insurance coverage before proceeding
- **Claim Rejection Audiences**: Policyholders who received claim denials and need guidance on why the claim was denied and what options they have for appeal

### Secondary Users (Phase 2+)

- **Insurance Agents**: Licensed insurance professionals who can use Bodam as a client support tool
- **General Agency (GA) Staff**: Insurance planners and sales teams who need to quickly access coverage information for clients
- **Insurance Consultants**: Independent advisors who help clients with policy selection and claim guidance

## Core Features

### 0. Insurance Document Crawler System

An automated system that crawls insurance company disclosure pages and extracts policy documents for the knowledge base.

**Capabilities**:
- Automated crawling of Korean insurance association disclosure pages (KLIA, KNIA)
- JavaScript-based web scraping using Playwright for dynamic content
- Automatic PDF download and storage to local filesystem or S3
- SHA-256 based delta crawling (only processes changed policies)
- Celery Beat scheduled execution (weekly Sunday 02:00 KST)
- Comprehensive error handling with exponential backoff retry logic
- Policy metadata tracking with crawler source, URL, last crawled timestamp

**Implementation**:
- BaseCrawler framework with abstract interface for future crawler expansion
- Company-specific crawlers: KLIA Crawler, KNIA Crawler
- Storage abstraction supporting LocalFileStorage (MVP) and S3Storage (stub)
- CrawlRun and CrawlResult database models for execution tracking
- Automatic integration with existing DocumentProcessor for PDF ingestion

**Status**: Implemented in SPEC-CRAWLER-001 (commit 1fff430)

---

### 1. Multi-LLM Router with Cost Optimization

An intelligent LLM routing system that selects the optimal language model based on query complexity, cost, and performance characteristics.

**Capabilities**:
- Intent-based query classification (policy lookup, claim guidance, general Q&A)
- Intelligent model selection: Gemini 2.0 Flash (primary), GPT-4o (fallback), GPT-4o-mini (classification)
- Automatic failover chain: handles API timeouts, rate limits, and errors gracefully
- Cost tracking and optimization: per-query token counting and USD cost estimation
- Confidence scoring for response quality assurance
- Structured logging with LLM metrics for analytics

**Components**:
- **IntentClassifier**: GPT-4o-mini based intent classification
- **LLMRouter**: ModelSelector with FallbackChain for cost-optimized routing
- **PromptManager**: Versioned templates for domain-specific prompts
- **QualityGuard**: Confidence scoring, hallucination detection, source citation
- **LLMMetrics**: Per-query and per-session cost/token tracking

**Status**: Implemented in SPEC-LLM-001 (commit 4646501)

---

### 2. Enhanced RAG Chain with Query Rewriting

An intelligent Retrieval-Augmented Generation pipeline that retrieves relevant insurance policy sections and generates accurate, context-aware responses.

**Capabilities**:
- Multi-step retrieval with query rewriting for improved accuracy
- Korean insurance terminology expansion (실손 → 실손의료보험, etc.)
- Deduplication of similar policy results
- Context window awareness with automatic history compression
- Result ranking and relevance scoring
- Integration with VectorSearchService for semantic search

**Components**:
- **RAGChain**: Multi-step orchestration with retrieval refinement
- **QueryRewriter**: Static dictionary-based term expansion (LLM-based expansion planned for Phase 2)
- **ContextBuilder**: Automatic history compression for long conversations

**Status**: Implemented in SPEC-LLM-001 (commit 4646501)

---

### 3. Claim Guidance Chatbot

An intelligent conversational interface that accepts natural language questions about insurance coverage and provides comprehensive, well-sourced answers.

**Capabilities**:
- Understand natural language questions in Korean about insurance compensation and coverage
- Identify relevant coverage types and policy terms from the database
- Explain coverage eligibility using clear, consumer-friendly language
- Provide citations to specific policy sections for verification
- Handle follow-up questions with conversation context awareness

**Use Cases**:
- "인공관절 수술을 할 예정인데, 보험에서 보상이 되나요?" (Will insurance cover my artificial joint surgery?)
- "교통사고로 입원치료 받았어. 보상 뭐 받을 수 있어?" (I was hospitalized after a car accident. What compensation can I get?)

**Status**: Enhanced with SPEC-LLM-001 (commit 4646501) - Strangler Fig refactoring maintains backward compatibility

---

### 5. Insurance Policy Database

A comprehensive, pre-indexed database of insurance policies from Korean insurance companies that serves as the knowledge foundation for claim analysis.

**Coverage**:
- All major Korean insurance companies (target: 80% market coverage in Phase 1)
- Current insurance products actively sold
- Discontinued products still in force (historical coverage)
- Legally mandated policy disclosures from insurance association
- Regular updates as new products are released (automated via SPEC-CRAWLER-001)

**Data Structure**:
- Policy terms (약관) with complete legal text
- Coverage categories (담보) with eligibility criteria
- Exclusions and limitations
- Compensation amount tables
- Geographic and temporal constraints

**Data Strategy - Progressive Expansion**:

Phase 1 (Months 1-3): Pre-index top 10 insurance companies covering approximately 80% of the market. Manually process publicly available policy documents and create structured database. Automated crawling via SPEC-CRAWLER-001 provides continuous updates.

Phase 2 (Months 4-6): Implement on-demand Gemini 2.0 Flash analysis using 1M context window for user-uploaded policy PDFs. Allow users to register their specific policies for real-time analysis without database modification.

Phase 3 (Months 7-12): Progressively accumulate new policies from user uploads (with consent) to expand database coverage. Prioritize policies with high claim frequency.

Phase 4 (Months 13+): Full automated crawling pipeline with intelligent policy processing. Establish data pipeline for continuous, automated updates.

### 7. Coverage Eligibility Analysis

Intelligent analysis that determines which coverage types (담보) may apply to a specific situation.

**Capabilities**:
- Analyze medical procedures, treatments, and prescriptions against policy coverage
- Identify all potentially applicable coverage items
- Determine eligibility based on policy terms, exclusions, and conditions
- Calculate compensation amounts for registered policies
- Highlight ambiguous cases that may require human review

**Analysis Types**:

Medical Procedure Analysis: User describes a specific procedure (e.g., knee replacement, cataract surgery). System analyzes all applicable coverage types including 실손 (real loss) insurance by generation, individual coverage items (수술, 진단, 입원), and special coverages.

Treatment & Prescription Analysis: User lists treatments received or medications prescribed. System identifies coverage for each component and aggregates total potential compensation.

Situation-Based Analysis: User describes a situation (accident, hospitalization, diagnosis). System maps situation to potentially applicable coverage and explains causation requirements.

### 8. Ambiguous Case Guidance (Under Demand)

For situations where policy terms are unclear or multiple interpretations exist, the platform provides probability-based guidance supported by precedent and trends.

**Status**: Planned for Phase 2 implementation

**Capabilities**:
- Identify ambiguous policy language and multiple interpretation possibilities
- Research recent court precedents related to coverage disputes
- Provide probability estimates for successful claims in ambiguous cases
- Suggest evidence and documentation strategies
- Recommend consultation with insurance professionals for edge cases

**Examples**:
- Coverage interpretation disputes where different courts have ruled differently
- Pre-existing condition classifications that depend on procedure timing
- Causation requirements for accidents with multiple contributing factors

### 9. Rejection Analysis

When policyholders receive claim denials, Bodam explains the rejection cause and suggests countermeasures.

**Capabilities**:
- Analyze rejection letters to identify specific policy grounds for denial
- Explain the legal and policy basis for the rejection in accessible language
- Identify documentation gaps that may have contributed to rejection
- Suggest evidence and documentation for appeal
- Recommend timing and process for formal appeals
- Highlight successful precedents for similar cases

**Appeal Guidance**:
- Internal appeal process within insurance company
- External complaint process through Financial Services Commission
- Legal remedies including litigation pathways
- Recommended timeline and documentation for each approach

### 10. Medical Procedure Query

Users can query specific medical treatments, surgeries, or prescriptions to discover all potentially compensable coverage items.

**Capabilities**:
- Search database by procedure name, procedure code, medical condition
- Return all insurance products offering coverage for the procedure
- Show coverage variations across different policies and companies
- Compare compensation amounts across products
- Identify cost gaps not covered by standard insurance

**Use Cases**:
- Planning elective surgery and comparing insurance coverage across policies
- Understanding coverage for ongoing treatments or medications
- Evaluating insurance products during annual open enrollment
- Comparing coverage when shopping for new insurance policies

### 11. Individual Policy Registration

Users can securely register their own insurance policies to enable personalized, exact claim amount calculation and coverage analysis.

**Capabilities**:
- Secure policy registration with verification
- Support for multiple policies per user
- OCR processing of policy documents
- Manual policy information entry
- Real-time coverage analysis based on registered policies
- Exact compensation amount calculation
- Policy status tracking and renewal reminders

**Registration Process**:
1. Upload policy document (PDF or image) or enter policy number
2. System verifies policy against insurance company records
3. User confirms policy details and enrolls
4. System indexes policy for personalized queries
5. User receives real-time coverage estimates based on their specific policy

**Security & Privacy**:
- Encrypted storage of policy documents
- No policy data shared with third parties without consent
- Compliance with PIPA (Personal Information Protection Act) requirements
- Right to deletion and data access requests
- Regular security audits

### 12. On-Demand Policy Analysis

Real-time analysis of user-uploaded policy PDFs using Gemini 2.0 Flash with 1M context window capability.

**Capabilities**:
- Direct PDF upload and analysis without requiring database entry
- Instant policy comprehension using advanced language models
- Custom queries against uploaded policy text
- Coverage analysis specific to uploaded policy
- Comparison with standard product offerings in database

**Technology**:
- Gemini 2.0 Flash API with 1M context window
- Rapid processing of large policy documents
- Token optimization to handle longer policies efficiently
- Fallback to database when Flash API unavailable

**Use Cases**:
- Users with discontinued or regional policies not in database
- Custom group policies with non-standard terms
- International policies or policies in transition
- Rapid policy analysis without manual database entry

### 13. User Authentication & Account Management

Secure account system enabling personalized policy management, history tracking, and preference storage.

**MVP Phase 1 Implementation**:
- Email/password-based registration and login
- JWT-based authentication with bcrypt password hashing
- Protected chat endpoints with user session isolation
- Frontend authentication UI using react-hook-form + zod validation
- Frontend route protection with middleware

**Status**: Implemented in SPEC-AUTH-001 (commit 210bbf8)

**Capabilities (Phase 1)**:
- User registration with email and password
- Secure login with JWT token generation (30-minute expiration)
- User profile retrieval via authenticated endpoint
- Password hashing with bcrypt (no plain text storage)
- Session isolation for chat conversations

**Account Features (Phase 2+)**:
- Social login integration (Kakao, Naver, Google)
- Two-factor authentication for security
- Policy portfolio management (multiple policies)
- Query history and saved searches
- Claim guidance recommendations
- Notification preferences
- Data export and deletion requests

## Business Model

### Revenue Strategy (Freemium Model)

**Free Tier**:
- Unlimited claim guidance questions
- Access to general policy database
- Basic coverage eligibility analysis
- Community discussion features

**Premium Tier** (Planned):
- Individual policy registration and management
- Exact compensation amount calculation
- Detailed appeal guidance with document templates
- Priority support and live agent consultation
- Advanced analytics and coverage optimization
- PDF policy upload and analysis

**Enterprise Tier** (B2B, Future):
- APIs for insurance agents and GAs
- White-label implementation for insurance partners
- Bulk policy analysis tools
- Integration with customer relationship management systems
- Analytics dashboards for agent networks

### Monetization (Phase 2+)

1. **Premium Subscriptions**: Monthly or annual subscriptions for users with registered policies
2. **B2B Licensing**: APIs and tools for insurance agents, GAs, and advisors
3. **White-Label Partnerships**: Insurance companies integrate Bodam into their own platforms
4. **Data Partnerships**: Anonymized claims trend data for insurance industry research
5. **Advertising**: Non-invasive insurance product recommendations

## Competitive Advantages

### 1. Comprehensive Coverage

Bodam covers all Korean insurance companies and products (current and discontinued), providing a unique, single-source-of-truth advantage compared to company-specific tools.

### 2. No Policy Registration Required

Unlike traditional insurance company tools that require policy verification, Bodam provides valuable guidance without requiring users to register their personal policies, lowering friction and enabling broader adoption.

### 3. Legal Precedent Integration

Bodam incorporates recent court precedents and insurance claim trends to provide guidance on ambiguous cases, going beyond simple policy matching to deliver sophisticated analysis.

### 4. Conversational Interface**

By adopting a ChatGPT/Gemini-style conversational interface, Bodam makes insurance guidance accessible to non-technical users and allows for follow-up questions and clarification.

### 5. Rejection Explanation & Appeal Support

Bodam's rejection analysis feature uniquely helps users understand why claims were denied and how to appeal, directly addressing a pain point that existing tools ignore.

### 6. Progressive Data Accumulation**

The combination of pre-indexed database (fast coverage) and on-demand analysis (flexible coverage) enables rapid launch with high coverage quality, while progressively expanding with user-contributed data.

## Market Opportunity

### Market Size

- Korean Insurance Market: ~$180 billion annually
- Active Insurance Policyholders: ~50 million
- Target Market (People preparing claims/understanding coverage): ~15 million annually
- Addressable Market at 5% penetration: 750,000 users
- Addressable Market at 20% penetration: 3 million users

### Market Trends

1. **Digital Insurance Adoption**: 65% of Korean insurance customers now prefer digital channels
2. **Self-Service Expectations**: 78% of policyholders want self-service tools to understand coverage
3. **AI Trust Growth**: 61% of consumers open to AI-powered insurance guidance
4. **Claims Digitization**: Insurance companies increasing digital claims processing
5. **Regulatory Support**: FSC promoting transparency and consumer protection in insurance

## Implementation Roadmap

### Phase 1: MVP Launch (Months 1-3)

**Goal**: Launch conversational chatbot with coverage database for top 10 insurance companies

**Deliverables**:
- Chatbot interface with natural language processing
- Pre-indexed database of top 10 insurance companies
- Basic coverage eligibility analysis
- Claim guidance with general recommendations

**Success Metrics**:
- 10,000 monthly active users
- 4.5+ star rating
- 85%+ claim eligibility accuracy
- 2-second average response time

### Phase 2: Enhanced Analysis (Months 4-6)

**Goal**: Add individual policy registration and exact compensation calculation

**Deliverables**:
- User authentication and account management
- Policy upload and OCR processing
- Gemini 2.0 Flash integration for on-demand analysis
- Premium subscription features
- Exact compensation calculation engine

**Success Metrics**:
- 50,000 monthly active users
- 5,000 registered policies
- 30% premium conversion rate
- 95%+ compensation accuracy for registered policies

### Phase 3: Expanded Coverage (Months 7-12)

**Goal**: Expand database to 80% of insurance market, add B2B features

**Deliverables**:
- Complete database of all major insurance companies
- Rejection analysis feature
- Appeal guidance system
- B2B API for agents and GAs
- White-label platform
- Analytics dashboards

**Success Metrics**:
- 200,000 monthly active users
- 30,000 registered policies
- 500 B2B partner sign-ups
- 40% premium conversion rate

### Phase 4: Ecosystem Integration (Months 13+)

**Goal**: Deep integration with insurance industry, automated updates, AI enhancements

**Deliverables**:
- Automated policy database updates via crawling
- Partnership integrations with insurance companies
- Advanced trend analysis and market insights
- Predictive claim guidance
- Mobile app launch
- International expansion

**Success Metrics**:
- 1 million monthly active users
- 100,000 registered policies
- 2,000 B2B partners
- 50% premium conversion rate
- Positive unit economics

## Technical Architecture

### Core Components

1. **Frontend**: Web application (React/Next.js) and mobile apps (React Native) with conversational UI
2. **Chatbot Engine**: LLM integration (Gemini/GPT-4) with prompt engineering for insurance domain
3. **Policy Database**: PostgreSQL with full-text search optimization for policy terms
4. **API Layer**: RESTful API for chatbot, policy management, and B2B integrations
5. **LLM Integration**: Gemini 2.0 Flash API with 1M context for PDF analysis
6. **Authentication**: JWT-based authentication with OAuth2 for social login
7. **Security**: Encryption at rest and in transit, PIPA compliance, regular security audits
8. **Deployment**: Cloud infrastructure (GCP/AWS) with auto-scaling and high availability

### Data Pipeline

1. **Policy Ingestion**: Manual collection, OCR processing, and validation of insurance policies
2. **Data Structuring**: Extraction of coverage types, eligibility criteria, exclusions
3. **Database Indexing**: Full-text search indexing for efficient policy retrieval
4. **Quality Assurance**: Manual review and automated testing of coverage analysis
5. **Continuous Updates**: Automated crawling of insurance association disclosure pages

## Success Metrics

### User Engagement

- **Monthly Active Users (MAU)**: Target 1 million by end of Year 2
- **Daily Active Users (DAU)**: Target 250,000 by end of Year 2
- **Average Session Duration**: Target 8+ minutes
- **Query Success Rate**: Target 95% successful policy matches
- **User Satisfaction**: Target 4.5+ stars across app stores

### Business Metrics

- **Free-to-Premium Conversion**: Target 30-40%
- **Premium Retention**: Target 80%+ monthly retention
- **B2B Partnerships**: Target 1,000+ agents and GA networks
- **Average Revenue Per User (ARPU)**: Target 5,000 KRW monthly
- **Customer Acquisition Cost (CAC)**: Target 10,000 KRW or less

### Quality Metrics

- **Coverage Accuracy**: Target 95%+ for claim eligibility determination
- **Compensation Calculation Accuracy**: Target 99%+ for registered policies
- **Response Time**: Target <2 seconds average
- **Uptime**: Target 99.9% availability
- **Data Privacy**: Target zero data breaches, 100% PIPA compliance

## Risk Analysis & Mitigation

### Regulatory Risks

**Risk**: Insurance regulators may restrict AI-based claim guidance as practicing insurance business without license

**Mitigation**:
- Design platform as educational tool providing information, not official claim determination
- Include disclaimers that recommendations are not binding
- Partner with licensed insurance professionals for sensitive advice
- Maintain regulatory compliance monitoring and adapt to rule changes
- Engage with FSC proactively on AI regulation

### Competitive Risks

**Risk**: Insurance companies may launch competing products or restrict data access

**Mitigation**:
- Establish partnerships with insurance companies early
- Build switching costs through user network effects and personalized data
- Develop B2B products that complement insurance company tools
- Focus on user trust through transparency and accuracy
- Create continuous value through legal precedent and trend analysis

### Data Risks

**Risk**: Policy data breaches may expose user personal information and policies

**Mitigation**:
- Implement bank-grade encryption and security practices
- Regular third-party security audits
- Minimal data retention (delete user data after claim resolution)
- Compliance with PIPA and data protection regulations
- Cyber insurance coverage

### Operational Risks

**Risk**: Database may become outdated as insurance companies change policies frequently

**Mitigation**:
- Automate policy updates through association disclosure crawling
- Establish data partnerships with insurance companies
- User feedback mechanisms to flag outdated coverage
- Regular quality assurance testing against real claims
- A/B testing to verify coverage analysis accuracy

## Success Criteria for Phase 1

The MVP will be considered successful when:

1. **Adoption**: Achieves 10,000+ monthly active users within 3 months
2. **Accuracy**: Demonstrates 85%+ accuracy on claim eligibility determination (verified against real insurance company decisions)
3. **Satisfaction**: Receives 4.5+ star ratings with positive user feedback on coverage guidance
4. **Performance**: Delivers responses in under 2 seconds average, with 99.9% uptime
5. **Market Validation**: Receives positive media coverage and insurance industry recognition
6. **Regulatory Compliance**: Maintains compliance with all relevant regulations without warnings from FSC
7. **Funding**: Attracts Series A funding from leading venture capital firms

## Conclusion

Bodam addresses a critical market need for accessible, AI-powered insurance claim guidance in Korea. By combining comprehensive policy databases with conversational AI and legal precedent analysis, Bodam will democratize access to insurance information and empower consumers to make informed decisions about their coverage.

The platform's phased approach enables rapid market entry with an MVP while progressively building toward a comprehensive insurance guidance ecosystem that serves individual consumers, insurance professionals, and insurance companies alike.

---

**Document Version**: 1.0
**Last Updated**: 2026-03-13
**Status**: Product Definition Complete
**Next Phase**: Architecture Design & Development Planning
