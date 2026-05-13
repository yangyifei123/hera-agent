// Package main demonstrates bug analysis, fixing, testing, and documentation
// in a Go codebase.
package main

import (
	"fmt"
	"strings"
)

// User represents a user in the system with basic identity fields.
//
// All fields are required for a valid user. Use ValidateUser to check
// completeness before processing.
type User struct {
	ID    string
	Email string
	Name  string
}

// ValidateUser checks whether a user is valid by verifying that all required
// fields are present and the email has a correct format.
//
// The function returns an error describing the first validation failure encountered.
// A nil user is treated as invalid.
//
// Parameters:
//   - user: pointer to the User to validate; may be nil
//
// Returns:
//   - error: describes the validation failure, or nil if the user is valid
func ValidateUser(user *User) error {
	if user == nil {
		return fmt.Errorf("user is required")
	}

	if user.ID == "" {
		return fmt.Errorf("user ID is required")
	}

	if user.Name == "" {
		return fmt.Errorf("user name is required")
	}

	if user.Email == "" {
		return fmt.Errorf("email is required")
	}

	if !strings.Contains(user.Email, "@") {
		return fmt.Errorf("invalid email format")
	}

	return nil
}

// ProcessOrder calculates and processes an order for the given user.
//
// The function applies a 10% discount to the order amount and prints
// a summary. Both the user and amount are validated before processing.
//
// Parameters:
//   - user:   pointer to the User placing the order; must be valid (see ValidateUser)
//   - amount: order total before discount; must be strictly positive
//
// Returns:
//   - error: describes the validation failure, or nil on success
func ProcessOrder(user *User, amount float64) error {
	if err := ValidateUser(user); err != nil {
		return fmt.Errorf("invalid user: %w", err)
	}

	if amount <= 0 {
		return fmt.Errorf("amount must be positive, got %.2f", amount)
	}

	discount := amount * 0.1
	total := amount - discount

	fmt.Printf("Processing order for %s: $%.2f\n", user.Email, total)
	return nil
}

func main() {
	user1 := &User{
		ID:    "1",
		Email: "test@example.com",
		Name:  "Test User",
	}
	if err := ProcessOrder(user1, 100.0); err != nil {
		fmt.Printf("Error: %v\n", err)
	}

	// Demonstrate error handling for nil user
	if err := ProcessOrder(nil, 50.0); err != nil {
		fmt.Printf("Error: %v\n", err)
	}

	// Demonstrate error handling for negative amount
	if err := ProcessOrder(user1, -100.0); err != nil {
		fmt.Printf("Error: %v\n", err)
	}
}
