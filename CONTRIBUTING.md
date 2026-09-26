# Contributing to Tunnelfy

First off, thank you for considering contributing to Tunnelfy! It's people like you that make Tunnelfy such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to <info@tunnelfy.com>.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [Troubleshooting section in the README](README.md#troubleshooting) as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* Use a clear and descriptive title
* Describe the exact steps which reproduce the problem
* Provide specific examples to demonstrate the steps
* Describe the behavior you observed after following the steps
* Explain which behavior you expected to see instead and why
* Include extension logs from the Output panel
* Include your VS Code version and OS information

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* A clear and descriptive title
* A detailed description of the proposed functionality
* Any possible drawbacks
* Impact on existing features
* If applicable, include mock-ups or examples

### Development Process

1. Fork the Repository
   ```bash
   # Clone your fork locally
   git clone git@github.com:your-username/tunnelfy.git
   cd tunnelfy
   ```

2. Set Up Development Environment
   ```bash
   # Install dependencies
   npm install
   npm install -g yo generator-code

   # Install recommended VS Code extensions
   code --install-extension dbaeumer.vscode-eslint
   code --install-extension esbenp.prettier-vscode
   ```

3. Create a Feature Branch
   ```bash
   git checkout -b feature/your-feature
   ```

4. Make Your Changes
   * Write code following our style guidelines
   * Add tests for new functionality
   * Update documentation as needed
   * Add logging statements for significant operations

5. Test Your Changes
   ```bash
   # Run the test suite
   npm test

   # Run ESLint
   npm run lint
   ```

6. Create a Pull Request
   * Push changes to your fork
   * Create a pull request to our development branch
   * Follow the pull request template
   * Wait for review and address feedback

### Pull Request Process

1. Update the README.md with details of changes to the interface, if applicable
2. Update the CHANGELOG.md with a note describing your changes
3. The PR will be merged once you have the sign-off of at least one maintainer

## Styleguides

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

### TypeScript Styleguide

* Use TypeScript's strict mode
* Follow VS Code extension guidelines
* Maintain clear separation of concerns
* Keep services focused and single-purpose

### Documentation Styleguide

* Use [Markdown](https://guides.github.com/features/mastering-markdown/)
* Reference functions with backticks: `functionName()`
* Include code examples when relevant
* Update relevant sections in README.md

### Testing Requirements

* Write tests for new features
* Update existing tests when modifying features
* Test error conditions
* Verify logging behavior
* Ensure full test coverage for security-related features

## Additional Notes

### Security Vulnerabilities

If you find a security vulnerability, please do NOT open an issue. Email <info@tunnelfy.com> instead.

### Issue and Pull Request Labels

* `bug` - Issues that are bugs
* `enhancement` - Issues that are feature requests
* `documentation` - Issues with documentation
* `security` - Security-related issues
* `good first issue` - Good for newcomers

## Questions?

If you have questions, please email <info@tunnelfy.com> or open a GitHub Discussion.