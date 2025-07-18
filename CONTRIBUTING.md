# Contributing to JigSwap 🧩

First off, thank you for considering contributing to JigSwap! We're thrilled you're here. This project is for the community, and we welcome any contributions, from reporting a bug to submitting a new feature.

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this open-source project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize your pull requests.

## Code of Conduct

We have a [Code of Conduct](CODE_OF_CONDUCT.md) to ensure that the JigSwap community is a welcoming and inclusive environment for everyone. Please make sure you read and follow it.

## How Can I Contribute?

There are many ways to contribute to the project!

*   **🐛 Reporting Bugs:** If you find a bug, please open an issue and provide as much detail as possible, including steps to reproduce it.
*   **✨ Suggesting Enhancements:** Have an idea for a new feature or an improvement to an existing one? Open an issue to start a discussion. This is the best way to ensure your idea aligns with the project's goals before you start working on it.
*   **📝 Improving Documentation:** If you see a typo, find something confusing, or think a section could be clearer, feel free to open a pull request to improve the documentation.
*   **🌐 Helping with Translations:** We use Crowdin to manage translations. If you'd like to help translate JigSwap into another language, please [link to your Crowdin project here].
*   **🧑‍💻 Writing Code:** If you're ready to write some code, you can get started with the development setup below.

## 🚀 Development Setup

Ready to start coding? Here's how to get the project running on your local machine.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   [pnpm](https://pnpm.io/installation) (v10.13.1 or later - our preferred package manager)
*   [Git](https://git-scm.com/)

### 1. Fork & Clone the Repository

First, fork the repository to your own GitHub account. Then, clone your fork to your local machine:

```bash
git clone https://github.com/SanderVerkuil/jigswap.git
cd jigswap
```

### 2. Install Dependencies

This project uses a monorepo structure with Nx workspace. Install all dependencies using `pnpm`:

```bash
pnpm install
```

### 3. Set Up Environment Variables

You'll need to set up accounts with Convex and Clerk to get the necessary API keys.

1.  Create a file named `.env.local` in the `apps/web` directory.
2.  Fill in the required values:

```env
# apps/web/.env.local

# Convex Backend
# 1. Run `cd packages/backend && pnpm convex:dev`
# 2. A new Convex project will be created for you.
# 3. Copy the URL from the command line output.
NEXT_PUBLIC_CONVEX_URL=https://your-convex-deployment.convex.cloud

# Clerk Authentication
# Get these from your Clerk project dashboard -> API Keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional: Crowdin Localization
CROWDIN_PROJECT_ID=your_project_id
CROWDIN_API_TOKEN=your_api_token
NEXT_PUBLIC_CROWDIN_DISTRIBUTION_HASH=your_distribution_hash
```

### 4. Run the Development Servers

JigSwap uses a monorepo structure with separate backend and frontend packages. You'll need to run both:

1.  **Start the Convex backend:**
    This watches your `packages/backend/convex/` directory for changes and pushes them to your Convex deployment.

    ```bash
    cd packages/backend
    pnpm convex:dev
    ```

2.  **Start the Next.js frontend:**
    In a separate terminal window, run from the root directory:

    ```bash
    pnpm dev
    ```

    Or alternatively, run the web app directly:
    ```bash
    cd apps/web
    pnpm dev
    ```

You should now be able to access the app at `http://localhost:3000`.

### Project Structure

This is a monorepo managed by Nx with the following structure:

```
jigswap/
├── apps/
│   └── web/                 # Next.js 15 frontend application
│       ├── src/
│       │   ├── app/         # Next.js App Router pages
│       │   ├── components/  # React components
│       │   └── lib/         # Utility functions and providers
│       ├── locales/         # Internationalization files
│       └── package.json     # Web app dependencies
├── packages/
│   ├── backend/             # Convex backend functions and schema
│   │   ├── convex/          # Convex functions and schema
│   │   └── package.json     # Backend dependencies
│   ├── shared-ui/           # Shared UI components
│   └── shared-utils/        # Shared utility functions
├── package.json             # Root workspace configuration
└── nx.json                  # Nx workspace configuration
```

##  Pull Request Workflow

1.  **Create a Branch:** Create a new branch for your changes. Use a descriptive name, like `feat/add-puzzle-search` or `fix/login-button-style`.

    ```bash
    git checkout -b feat/your-new-feature
    ```

2.  **Make Your Changes:** Write your code and tests. Make sure to follow the style guides.

3.  **Format and Lint:** Before committing, run the linter to ensure your code follows our style guidelines.

    ```bash
    pnpm lint:fix
    ```

4.  **Commit Your Changes:** Use a descriptive commit message that follows our [commit message conventions](#git-commit-messages).

    ```bash
    git commit -m "feat: Add search functionality to puzzle list"
    ```

5.  **Push to Your Fork:**

    ```bash
    git push origin feat/your-new-feature
    ```

6.  **Open a Pull Request:** Go to the JigSwap repository on GitHub and open a new pull request. Fill out the PR template with details about your changes.

## Style Guides

### Git Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for our commit messages. This helps us automatically generate changelogs and makes the project history easier to read.

The basic format is: `<type>(<scope>): <subject>`

*   **`feat`**: A new feature
*   **`fix`**: A bug fix
*   **`docs`**: Documentation only changes
*   **`style`**: Changes that do not affect the meaning of the code (white-space, formatting, etc)
*   **`refactor`**: A code change that neither fixes a bug nor adds a feature
*   **`chore`**: Changes to the build process or auxiliary tools

### Code Style

We use [Prettier](https://prettier.io/) for code formatting and [ESLint](https://eslint.org/) for linting. The rules are defined in the repository. Please run `pnpm lint:fix` before committing your changes to automatically format your code.

---

Thank you again for your interest in making JigSwap better!
