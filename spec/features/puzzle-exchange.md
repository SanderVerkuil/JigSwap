# Puzzle Exchange System

## Feature Description
Users can engage in various types of puzzle exchanges with other enthusiasts while maintaining complete ownership history and preserving personal completion records.

## User Stories

**As a puzzle owner,**
- I want to set my puzzles as available for lending so that others can borrow them
- I want to propose swaps with other users so that I can get new puzzles to try
- I want to sell puzzles I no longer want so that I can make room for new ones
- I want to specify exchange terms and conditions so that expectations are clear
- I want to set pricing for tradeable puzzles so that I can get fair value
- I want to maintain my completion history even after trading a puzzle so that I don't lose my records
- I want to track the condition of my puzzles through exchanges so that I know their state

**As a puzzle seeker,**
- I want to browse puzzles available for exchange so that I can find interesting ones to try
- I want to filter puzzles by type, difficulty, brand, and location so that I can find relevant options
- I want to search for specific puzzles so that I can find particular items I'm interested in
- I want to see puzzle condition and completion history so that I can make informed decisions
- I want to view user profiles and ratings so that I can assess the reliability of exchange partners

**As a puzzle borrower/buyer,**
- I want to request to borrow puzzles so that I can try them before buying
- I want to propose swaps with my own puzzles so that I can get new ones to try
- I want to negotiate exchange terms so that both parties are satisfied
- I want to see complete puzzle information before agreeing to exchanges

**As an exchange participant,**
- I want to communicate with other users during exchanges so that we can coordinate details
- I want to track the status of all my exchanges so that I know what's happening
- I want to upload photos to document puzzle condition so that there's clear evidence
- I want to mark exchanges as completed or report disputes so that the system stays accurate
- I want to rate my exchange experience so that I can help other users

## Acceptance Criteria

### Exchange Discovery
- [ ] Users can browse puzzles available for exchange with filtering options
- [ ] Users can filter by exchange type (lend, swap, trade), location, piece count, difficulty, brand
- [ ] Users can filter by friend circle to see puzzles shared within their circles
- [ ] Users can search for specific puzzles by title or brand
- [ ] Users can view puzzle details including condition, completion history, and owner rating
- [ ] Users can see distance to puzzle owner for local exchanges
- [ ] Users can save searches and get notifications for new matches

### Exchange Initiation
- [ ] Users can initiate exchange requests with specified terms
- [ ] Users can accept, decline, or counter exchange proposals
- [ ] Users can set pricing for tradeable puzzles
- [ ] Users can specify exchange duration for lending
- [ ] Users can add conditions and requirements to exchange requests
- [ ] Users can propose multiple puzzles for swaps

### Exchange Management
- [ ] Users can track exchange status (pending, active, completed, cancelled, disputed)
- [ ] Users can send and receive messages during exchanges
- [ ] Users can upload photos to document puzzle condition
- [ ] Users can mark exchanges as completed or report disputes
- [ ] Users can rate exchange experience after completion
- [ ] Users can extend lending periods with mutual agreement

### Ownership and History
- [ ] Original completion history remains with the original owner
- [ ] New puzzle instances are created for new owners
- [ ] Complete ownership history is tracked for each puzzle
- [ ] Users can view complete chain of custody for their puzzles
- [ ] Condition tracking is maintained through all exchanges
- [ ] Users can see when their puzzles are being used by others

## Technical Requirements

### Data Model
- **Exchange**: Exchange request with type, terms, and status
- **Exchange Instance**: New puzzle instance created during exchanges
- **Ownership History**: Complete chain of custody for each puzzle instance
- **Exchange Message**: Real-time communication during exchanges
- **Condition Record**: Puzzle condition documentation with photos

### Exchange Types
- **Lending**: Temporary borrowing with return agreement
- **Swapping**: Permanent exchange of puzzles between users
- **Trading/Selling**: Direct sale or auction of puzzles

### Key Features
- History preservation through new instance creation
- Complete ownership chain tracking
- Real-time messaging during exchanges
- Condition documentation and tracking
- Dispute resolution system
- Exchange rating and feedback system 