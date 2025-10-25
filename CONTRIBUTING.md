# Contributing to PR-REVIEW-XIBE

Thank you for your interest in contributing to PR-REVIEW-XIBE! We welcome contributions from everyone.

## 🤝 Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## 🚀 Getting Started

### Prerequisites

- Node.js v14.0.0 or higher
- npm or yarn
- Git
- A GitHub account

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
```bash
git clone https://github.com/iotserver24/PR-REVIEW-XIBE.git
cd PR-REVIEW-XIBE
```

3. Add the upstream repository:
```bash
git remote add upstream https://github.com/iotserver24/PR-REVIEW-XIBE.git
```

### Install Dependencies

```bash
npm install
```

## 📝 Making Changes

### Branch Naming

Create a branch for your changes:
```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding or updating tests

### Code Style

- Follow existing code style and conventions
- Use meaningful variable and function names
- Comment complex logic
- Keep functions small and focused

### Commit Messages

Write clear, descriptive commit messages:

```bash
# Good commit message
git commit -m "feat: add rate limiting to webhook endpoint"

# Avoid
git commit -m "fixed stuff"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

## 🧪 Testing

Run tests before submitting:

```bash
npm test
```

Add tests for new features or bug fixes.

## 📤 Submitting Changes

### Pull Request Process

1. **Update your branch**:
```bash
git fetch upstream
git rebase upstream/main
```

2. **Push your changes**:
```bash
git push origin feature/your-feature-name
```

3. **Create a Pull Request**:
   - Go to GitHub
   - Click "New Pull Request"
   - Select your fork and branch
   - Fill out the PR template

### Pull Request Checklist

- [ ] Code follows project style guidelines
- [ ] Tests pass locally
- [ ] Documentation updated (if needed)
- [ ] No console.log or debug code
- [ ] Commit messages are clear
- [ ] Branch is up to date with main

## 🐛 Reporting Bugs

### Before Submitting

- Check if the bug has already been reported
- Test on the latest version
- Check documentation

### Bug Report Template

```markdown
**Description**
A clear description of the bug

**Steps to Reproduce**
1. Step one
2. Step two
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- Node.js version:
- npm version:
- OS:

**Additional Context**
Any other relevant information
```

## 💡 Suggesting Features

Feature suggestions are welcome! Please include:

- Clear description of the feature
- Use cases and examples
- Potential implementation approach
- Benefits for users

## 📚 Documentation

Improving documentation is just as valuable as code contributions:

- Fix typos
- Clarify unclear sections
- Add missing information
- Improve code comments

## 🔍 Code Review

All submissions require review. We may suggest changes or ask questions.

Common feedback:
- Code style consistency
- Performance optimizations
- Test coverage
- Documentation completeness

## 🎯 Areas for Contribution

Looking for ideas? Here are some areas:

- **Testing**: Increase test coverage
- **Documentation**: Improve guides and examples
- **Performance**: Optimize code execution
- **Features**: Add new functionality
- **Bug Fixes**: Fix reported issues
- **Refactoring**: Improve code quality

## ❓ Questions?

- Check existing [Issues](https://github.com/iotserver24/PR-REVIEW-XIBE/issues)
- Start a [Discussion](https://github.com/iotserver24/PR-REVIEW-XIBE/discussions)
- Contact maintainers

## 📜 License

By contributing, you agree that your contributions will be licensed under the same license as the project (CC BY-NC-SA 4.0).

## 🙏 Thank You!

Your contributions help make PR-REVIEW-XIBE better for everyone. We appreciate your time and effort!
