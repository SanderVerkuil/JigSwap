# JigSwap - Personal Puzzle Library & Exchange Platform

A comprehensive platform for jigsaw puzzle enthusiasts to manage their personal collections, track completion history, and engage in various types of puzzle exchanges. Built with Next.js 15, Convex, Clerk, and Tailwind CSS.

**JigSwap is a family side project** born from our own need to easily see and exchange puzzles with friends and family. What started as a simple solution for our puzzle-loving family has grown into a platform for the broader puzzle community.

## 🧩 Features

### Personal Library Management

- **Collection Tracking**: Maintain your personal puzzle library with detailed information
- **Completion History**: Record and track every puzzle completion with timing, ratings, and reviews
- **Performance Analytics**: Analyze your solving patterns, preferences, and progress over time
- **Photo Documentation**: Upload completion photos and track puzzle condition changes
- **Multiple Completions**: Track how often you complete the same puzzle and see your improvement over time
- **Personal Reviews**: Write detailed reviews and notes for each completion experience

### Puzzle Exchange System

- **Multiple Exchange Types**: Lend, swap, or trade puzzles with other enthusiasts
- **Visibility Controls**: Set puzzles as private, visible, lendable, swappable, or tradeable
- **Ownership History**: Complete chain of custody tracking while preserving personal history
- **Condition Tracking**: Monitor puzzle condition through all exchanges
- **History Preservation**: Your completion history remains intact even after trading puzzles
- **New Instance Creation**: When puzzles are exchanged, new instances are created to maintain ownership history

### Community Features

- **User Profiles**: Showcase your collection and completion achievements
- **Reviews & Ratings**: Share and discover community reviews of puzzles
- **Social Discovery**: Find nearby users and discover new puzzles
- **Real-time Messaging**: Communicate directly with other users during exchanges

### Technical Excellence

- **Real-time Updates**: Live updates using Convex real-time database
- **Internationalization**: Support for English and Dutch with Crowdin
- **Responsive Design**: Mobile-first design with dark mode support
- **Form Validation**: Comprehensive form validation with Zod and react-hook-form
- **Error Handling**: Robust error boundaries and user feedback systems

## 🏠 Our Story

JigSwap began as a family side project in 2025. We were tired of constantly asking friends and family "What puzzles do you have?" and wanted an easy way to see and exchange puzzles within our circle. What started as a simple solution for our puzzle-loving family has grown into a platform that serves the broader puzzle community.

Our mission is to make puzzle sharing sustainable, accessible, and enjoyable for everyone - whether you're trading with family members or connecting with fellow enthusiasts worldwide.

## 🚀 Tech Stack

### Frontend

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS v4** - Utility-first CSS framework
- **ShadCN/UI** - Reusable component library
- **React Hook Form** - Form handling with validation
- **Zod** - Runtime type validation
- **next-intl** - Internationalization

### Backend

- **Convex** - Real-time backend and database
- **Clerk** - Authentication and user management

### Localization

- **Crowdin** - Translation management platform
- **Cookie-based locale detection** - No URL-based routing

### Development Tools

- **Turborepo** - Monorepo task runner and cache
- **pnpm** - Fast, disk space efficient package manager (v10.13.1)
- **oxlint** - Code linting
- **TypeScript** - Static type checking
- **Turbopack** - Fast development builds
- **Prettier** - Code formatting
- **Vitest** - Unit testing framework

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **pnpm** (v10.13.1 or higher)
- **Git**

## 🛠️ Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/SanderVerkuil/jigswap.git
   cd jigswap
   ```

2. **Install dependencies**
   This project is a pnpm workspace monorepo (tasks run via Turborepo):

   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   Copy the example environment file and fill in your values:

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

   Fill in the required environment variables in `apps/web/.env.local`:
   - Get Convex URL by running the backend setup (step 4)
   - Get Clerk keys from your [Clerk dashboard](https://clerk.com)
   - Crowdin settings are optional for translation contributions

4. **Set up Convex**

   ```bash
   cd packages/backend
   pnpm convex:dev
   ```

   This will:
   - Create a new Convex project (if needed)
   - Deploy your schema and functions
   - Start the development server

5. **Start the development server**
   In a separate terminal, from the root directory:

   ```bash
   pnpm dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🔧 Configuration

### Environment Variables

Create a `.env.local` file in the `apps/web` directory with the following variables:

```env
# Convex Backend
CONVEX_DEPLOYMENT=dev:your-deployment-name
NEXT_PUBLIC_CONVEX_URL=https://your-convex-deployment.convex.cloud

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_FRONTEND_API_URL=https://your-clerk-frontend.clerk.accounts.dev

# Crowdin Localization (Optional)
CROWDIN_PROJECT_ID=your_crowdin_project_id
CROWDIN_API_TOKEN=your_crowdin_api_token
NEXT_PUBLIC_CROWDIN_DISTRIBUTION_HASH=your_crowdin_distribution_hash
```

### Clerk Setup

1. Create a Clerk account at [clerk.com](https://clerk.com)
2. Create a new application
3. Copy the publishable key and secret key to your `apps/web/.env.local`
4. The sign-in/sign-up URLs are automatically configured in the app

### Convex Setup

1. Navigate to the backend package: `cd packages/backend`
2. Run `pnpm convex:dev` to set up your Convex project
3. The schema and functions will be automatically deployed
4. Copy the deployment URL to your `apps/web/.env.local`

### Crowdin Setup (Optional)

1. Create a Crowdin account and project
2. Upload the source translation file (`locales/source.json`)
3. Configure the distribution hash for OTA updates

## 📁 Project Structure

```
jigswap/
├── apps/
│   └── web/                   # Next.js 15 frontend application
│       ├── src/
│       │   ├── app/           # Next.js App Router pages
│       │   │   ├── (auth)/    # Authentication pages
│       │   │   └── (dashboard)/ # Protected dashboard pages
│       │   ├── components/    # React components
│       │   │   └── ui/        # Reusable UI components
│       │   └── lib/           # Utility functions and providers
│       ├── locales/           # Internationalization files
│       │   └── source.json    # Source translations
│       ├── public/            # Static assets
│       ├── .env.local         # Environment variables
│       ├── next.config.ts     # Next.js configuration
│       └── package.json       # Web app dependencies
├── packages/
│   └── backend/               # Convex backend functions and schema
│       ├── convex/            # Convex functions and schema
│       │   ├── schema.ts      # Database schema
│       │   ├── users.ts       # User functions
│       │   ├── puzzles.ts     # Puzzle functions
│       │   ├── collections.ts # Collection management
│       │   ├── completions.ts # Completion tracking
│       │   ├── exchanges.ts   # Exchange system
│       │   └── reviews.ts     # Review system
│       └── package.json       # Backend dependencies
├── spec/                      # Platform specifications
│   ├── README.md             # Main specification document
│   ├── database-schema.md    # Database schema specification
│   ├── user-interface.md     # UI/UX specification
│   ├── api-specification.md  # API specification
│   └── feature-roadmap.md    # Development roadmap
├── package.json               # Root workspace configuration
├── turbo.json                 # Turborepo task pipeline
└── pnpm-workspace.yaml        # pnpm workspace configuration
```

## 🎯 Available Scripts

### Root Workspace Scripts

- `pnpm dev` - Start development server for web app with Turbopack
- `pnpm dev:web` - Start web app development server
- `pnpm build` - Build all projects
- `pnpm build:web` - Build web app for production
- `pnpm start` - Start production server for web app
- `pnpm start:web` - Start web app production server
- `pnpm lint` - Run oxlint on all projects
- `pnpm lint:fix` - Fix oxlint errors on all projects
- `pnpm type-check` - Run TypeScript type checking on all projects
- `pnpm test` - Run tests on all projects
- `pnpm clean` - Clean build artifacts and the Turborepo cache
- `pnpm format` - Format code with Prettier
- `pnpm graph` - Write the task graph to graph.html

### Web App Scripts (apps/web)

- `pnpm dev` - Start Next.js development server with Turbopack
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run oxlint
- `pnpm lint:fix` - Fix oxlint errors
- `pnpm type-check` - Run TypeScript type checking
- `pnpm build:analyze` - Build with bundle analyzer
- `pnpm build:production` - Build with production environment
- `pnpm preview` - Build and start production server
- `pnpm clean` - Clean build artifacts
- `pnpm crowdin:upload` - Upload source translations
- `pnpm crowdin:download` - Download translations

### Backend Scripts (packages/backend)

- `pnpm convex:dev` - Start Convex development server
- `pnpm convex:deploy` - Deploy Convex functions to production

## 🌐 Internationalization

JigSwap supports multiple languages using next-intl and Crowdin:

- **Source Language**: English (en)
- **Supported Languages**: English, Dutch (nl)
- **Translation Management**: Crowdin with OTA updates
- **Locale Detection**: Cookie-based (no URL routing)

### Adding New Languages

1. Add the language code to the i18n configuration
2. Create translation files in Crowdin
3. Update the language switcher component

## 🔒 Authentication & Authorization

- **Authentication**: Handled by Clerk
- **User Management**: Automatic user creation in Convex
- **Protected Routes**: Dashboard pages require authentication
- **Middleware**: Handles auth and locale detection

## 📊 Database Schema

The application uses Convex with the following main entities:

- **Users**: User profiles, preferences, and statistics
- **Puzzles**: Puzzle information and metadata
- **Collections**: User-puzzle relationships with ownership tracking and visibility levels
- **Completions**: Detailed completion records with timing, ratings, and personal reviews
- **Exchange Instances**: New puzzle instances created during exchanges to preserve history
- **Exchanges**: All types of puzzle exchanges (lend, swap, trade, auction)
- **Exchange Messages**: Real-time communication during exchanges
- **Ownership History**: Complete chain of custody tracking for each puzzle instance
- **Reviews**: Community ratings and feedback
- **Notifications**: System and exchange notifications

## 🎨 Styling & Theming

- **Design System**: Custom design tokens with Tailwind CSS
- **Dark Mode**: System preference with manual toggle
- **Components**: ShadCN/UI with custom styling
- **Responsive**: Mobile-first approach
- **Brand Colors**: Custom JigSwap color palette

## 🚀 Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

### Other Platforms

The application can be deployed to any platform that supports Next.js:

- Netlify
- Railway
- DigitalOcean App Platform
- AWS Amplify

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

Please follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - The React framework
- [Convex](https://convex.dev/) - Real-time backend
- [Clerk](https://clerk.com/) - Authentication
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
- [ShadCN/UI](https://ui.shadcn.com/) - Component library
- [Crowdin](https://crowdin.com/) - Localization platform

## 📞 Support

If you have any questions or need help, please:

- Open an issue on GitHub
- Check the documentation
- Contact the development team

---

Made with ❤️ by a puzzle-loving family for the jigsaw puzzle community
