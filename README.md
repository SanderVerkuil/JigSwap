# JigSwap - Jigsaw Puzzle Trading Platform

A modern, full-stack web application for trading jigsaw puzzles with fellow enthusiasts. Built with Next.js 15, Convex, Clerk, and Tailwind CSS.

## 🧩 Features

- **User Authentication**: Secure authentication with Clerk
- **Puzzle Management**: Add, edit, and manage your puzzle collection
- **Browse & Search**: Discover puzzles from other users with advanced filtering
- **Trade System**: Request and manage puzzle trades with other users
- **Real-time Updates**: Live updates using Convex real-time database
- **Internationalization**: Support for English and Dutch with Crowdin
- **Responsive Design**: Mobile-first design with dark mode support
- **Form Validation**: Comprehensive form validation with Zod and react-hook-form
- **Error Handling**: Robust error boundaries and user feedback systems

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
- **Nx** - Monorepo build system and development tools
- **pnpm** - Fast, disk space efficient package manager (v10.13.1)
- **ESLint** - Code linting
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
   This project uses a monorepo structure with Nx workspace:
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
│   ├── backend/               # Convex backend functions and schema
│   │   ├── convex/            # Convex functions and schema
│   │   │   ├── schema.ts      # Database schema
│   │   │   ├── users.ts       # User functions
│   │   │   ├── puzzles.ts     # Puzzle functions
│   │   │   └── trades.ts      # Trade functions
│   │   └── package.json       # Backend dependencies
│   ├── shared-ui/             # Shared UI components
│   │   └── src/lib/           # Shared UI library
│   └── shared-utils/          # Shared utility functions
│       └── src/lib/           # Shared utilities library
├── package.json               # Root workspace configuration
├── nx.json                    # Nx workspace configuration
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
- `pnpm lint` - Run ESLint on all projects
- `pnpm lint:fix` - Fix ESLint errors on all projects
- `pnpm type-check` - Run TypeScript type checking on all projects
- `pnpm test` - Run tests on all projects
- `pnpm clean` - Clean build artifacts and reset Nx cache
- `pnpm format` - Format code with Prettier
- `pnpm graph` - View Nx dependency graph

### Web App Scripts (apps/web)
- `pnpm dev` - Start Next.js development server with Turbopack
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Fix ESLint errors
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

- **Users**: User profiles and preferences
- **Puzzles**: Puzzle information and ownership
- **Trade Requests**: Trade proposals and status
- **Messages**: Trade-related messaging
- **Reviews**: User ratings and feedback
- **Notifications**: System notifications

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

Made with ❤️ for the jigsaw puzzle community
